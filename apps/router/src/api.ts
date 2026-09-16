/**
 * Router API handlers (Task 23) — framework-free so Next.js routes and the
 * standalone server both call them.
 *
 *   POST /v1/quote  → engine + guard + (optional) split, per representation
 *   POST /v1/build  → planner + builder for a quoteId, execution-flag gated
 *   POST /v1/submit → reserved (501 until Task 17 transports are validated)
 *
 * Quotes are cached by `quoteId` for their lifetime so /v1/build can only
 * build what /v1/quote produced. Nothing here marks a route executable
 * beyond what the guard verdict says; `executionProtection.mode` is
 * "quote-only" for every direct venue until live validation passes and the
 * execution flag is on.
 */
import { createHash } from "node:crypto";
import type { Connection } from "@solana/web3.js";
import {
  USDC_MINT,
  bpsOf,
  flagEnabled,
  intermediateRecord,
  fromRaw,
  inspectMint,
  poolByAddress,
  quoteRepresentation,
  routerRepresentation,
  type EngineResult,
  type QuoteRequest,
  type RankedQuote,
  type RankedRoute,
  type ReferencePrice,
  type TelemetrySink,
  type VenueAdapter,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, effectiveSlippageBps, guardQuote, guardResult, type GuardVerdict } from "@henar/execution-guard";
import { buildTransaction, normalizeSimulation, planExecution, type BlockhashProvider, type LegInstructionBuilder, type Simulator } from "@henar/tx-builder";
import type { RouterHealth } from "./health";

export type ApiDeps = {
  adapters: VenueAdapter[];
  connection: Connection | null;
  health: RouterHealth | null;
  telemetry?: TelemetrySink | null;
  policy?: typeof DEFAULT_EXECUTION_POLICY;
  reference?: (representationId: string) => Promise<ReferencePrice | null>;
  currentSlot?: () => Promise<number | null>;
  treasuryOwner?: string | null;
  blockhash?: BlockhashProvider;
  legBuilder?: LegInstructionBuilder;
  /**
   * Pre-send simulation gate. When configured, every built transaction is
   * simulated as the owner before it is returned, and a route whose
   * simulated output lands below the plan floor (or that errors) is refused
   * rather than handed to the wallet. Quoting a good price proves nothing
   * about being able to execute it.
   */
  simulator?: Simulator | null;
  now?: () => number;
  quoteTtlMs?: number;
};

export type QuoteApiRequest = {
  representationId: string;
  side: "buy" | "sell";
  amount: string;
  wallet?: string | null;
  maxSlippageBps?: number | null;
  /** Diagnostic override for the per-venue deadline; the engine default otherwise. */
  deadlineMs?: number;
};

export type QuoteApiResponse = {
  quoteId: string;
  company: string;
  representation: { id: string; provider: string; symbol: string; mint: string; decimals: number | null };
  issuer: string;
  side: "buy" | "sell";
  amountIn: string;
  expectedOutput: string | null;
  minOutput: string | null;
  /** Expected net to the user (after Henar fee), not the floor. */
  netUserOutput: string | null;
  /** Guard floor net to the user; null when not approved. */
  minNetUserOutput: string | null;
  effectivePrice: string | null;
  fees: { henarBps: number; henarAmount: string; henarMint: string; venueFeeAmount: string | null } | null;
  priceImpactBps: number | null;
  expiresAt: string;
  route: { venue: string; poolAddress: string | null; percentBps: number; inputMint?: string; outputMint?: string }[] | null;
  /** How `route` executes: legs in parallel over one pair, or in sequence through an intermediate. */
  routeKind: "single" | "split" | "path" | null;
  /**
   * The route Henar's own optimizer built, when it built one that is safe and
   * worth an extra leg — whether or not it won. Null when the optimizer
   * resolved to a single venue, which already appears among the quotes and
   * must not be listed twice under two names.
   */
  henarRoute: {
    legs: { venue: string; poolAddress: string | null; percentBps: number }[];
    netOutput: string;
    minNetUserOutput: string;
    improvementBps: number | null;
    costBps: number;
    priceImpactBps: number | null;
    executable: boolean;
  } | null;
  /** Why there is, or is not, a Henar-constructed route. */
  henarRouteReason: string | null;
  /**
   * The best two-leg path through a qualified intermediate, when one could
   * be built, whether or not it won. `executable` is true only when every
   * leg passed the guard and the guard's floor on the first hop is exactly
   * the amount the second hop was sized on.
   */
  henarPath: {
    legs: { venue: string; poolAddress: string | null; inputMint: string; outputMint: string; amountIn: string; expectedAmountOut: string; percentBps: number }[];
    intermediate: { mint: string; symbol: string | null; decimals: number } | null;
    /** Expected intermediate left in the wallet above the first hop's floor. */
    residual: { mint: string; expected: string } | null;
    netOutput: string;
    minNetUserOutput: string | null;
    improvementBps: number | null;
    executable: boolean;
    reason: string | null;
    /** Guard checks that failed, per leg, so a refused path can be diagnosed from the response. */
    failedChecks: { leg: number; venue: string; checks: string[] }[];
  } | null;
  henarPathReason: string | null;
  /** Per-venue quote latency, so a timeout can be attributed to a cause. */
  latencyMs: Record<string, number>;
  alternatives: { venue: string; netOutput: string; priceImpactBps: number | null; approved: boolean; reason: string | null; failedChecks: string[]; routePlan?: unknown }[];
  /** Jupiter's own route plan (AMM labels, pools, split) for venue-coverage analysis. */
  benchmarkRoutePlan: unknown;
  exclusions: { venue: string; reason: string; detail: string | null }[];
  executionProtection: { mode: "execute" | "quote-only" | "refused"; slippageBps: number | null; checks: { name: string; ok: boolean; detail: string }[]; policy: string } | null;
  verification: { poolVerification: string | null; onchainCheckedAtQuote: boolean | null; calculatorStatus: string } | null;
  unavailableReason: string | null;
  /** Best approved quote regardless of executability (the meta-aggregator benchmark). */
  bestQuote: { venue: string; netOutput: string; executable: boolean; via: "henar-router" | "review-swap" | "none" } | null;
  /** Every quote considered, winner included and flagged. `alternatives`
   *  excludes the selected quote, which makes the response impossible to
   *  audit on its own: a reader comparing `bestQuote` against `alternatives`
   *  cannot see the quote that actually won. */
  comparison:
    | {
        venue: string;
        poolAddress: string | null;
        netOutput: string;
        priceImpactBps: number | null;
        approved: boolean;
        mode: string | null;
        reason: string | null;
        selected: boolean;
        capability: ExecutionCapability;
        quotedAt: string;
        stateSlot: number | null;
      }[]
    | null;
  liveValidation: "LIVE_VALIDATION_PENDING";
};

type CachedQuote = { response: QuoteApiResponse; verdict: GuardVerdict | null; legVerdicts: GuardVerdict[] | null; routeKind: "single" | "split" | "path"; path: RankedRoute | null; result: EngineResult; expiresAt: number };

/**
 * What a route can actually be executed through.
 *
 *  HENAR_NATIVE          the router builds and submits the instructions.
 *  EXTERNAL_EXECUTABLE   the router cannot build it, but the user can execute
 *                        the same swap through the reviewed /api/market path,
 *                        which validates the transaction byte for byte, keeps
 *                        the fee instruction atomic with the swap, and cannot
 *                        change the representation under the user.
 *  QUOTE_ONLY            comparison only; no path to a signature.
 */
export type ExecutionCapability = "HENAR_NATIVE" | "EXTERNAL_EXECUTABLE" | "QUOTE_ONLY";

export function capabilityOf(verdict: GuardVerdict): ExecutionCapability {
  if (!verdict.approved) return "QUOTE_ONLY";
  if (verdict.mode === "execute") return "HENAR_NATIVE";
  return verdict.quote.executionPath === "legacy-market-api"
    ? "EXTERNAL_EXECUTABLE"
    : "QUOTE_ONLY";
}

/**
 * Henar keeps its own route only when it is not materially worse.
 *
 * Owning the instruction builder is worth something in reliability terms, but
 * not basis points: a $10k NVDAx quote once chose Raydium over an approved
 * Jupiter route worth 9.26 bps more, purely because the router could build it.
 * Native is now a tie-breaker inside a threshold, not a trump card.
 */
const NATIVE_PREFERENCE_BPS = Number(process.env.HENAR_NATIVE_PREFERENCE_BPS ?? "1");

export function selectRoute(
  verdicts: GuardVerdict[],
  nativePreferenceBps = NATIVE_PREFERENCE_BPS,
): GuardVerdict | undefined {
  const executable = verdicts.filter((v) => capabilityOf(v) !== "QUOTE_ONLY");
  if (!executable.length) return undefined;
  const better = (a: GuardVerdict, b: GuardVerdict) =>
    fromRaw(b.quote.netOutput) > fromRaw(a.quote.netOutput) ? b : a;
  const best = executable.reduce(better);
  const bestNet = fromRaw(best.quote.netOutput);
  if (bestNet <= 0n) return best;
  const natives = executable.filter((v) => capabilityOf(v) === "HENAR_NATIVE");
  if (!natives.length) return best;
  const bestNative = natives.reduce(better);
  if (bestNative === best) return best;
  const gapBps = ((bestNet - fromRaw(bestNative.quote.netOutput)) * 10_000n) / bestNet;
  return gapBps <= BigInt(Math.max(0, Math.trunc(nativePreferenceBps)))
    ? bestNative
    : best;
}

export class RouterApi {
  private readonly cache = new Map<string, CachedQuote>();
  constructor(private readonly deps: ApiDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  async quote(body: QuoteApiRequest): Promise<{ status: number; body: QuoteApiResponse | { error: string } }> {
    if (!flagEnabled("routerQuotes")) return { status: 503, body: { error: "HENAR_ROUTER_QUOTES is off" } };
    const rep = routerRepresentation(body.representationId);
    if (!rep) return { status: 404, body: { error: "unknown representation" } };
    if (body.side !== "buy" && body.side !== "sell") return { status: 400, body: { error: "side must be buy or sell" } };
    let amount: bigint;
    try {
      amount = fromRaw(body.amount);
    } catch {
      return { status: 400, body: { error: "amount must be a raw integer string" } };
    }
    if (amount <= 0n) return { status: 400, body: { error: "amount must be positive" } };
    const request: QuoteRequest = {
      representationId: rep.id,
      side: body.side,
      amount: body.amount,
      amountType: "input",
      inputMint: body.side === "buy" ? USDC_MINT : rep.mint,
      outputMint: body.side === "buy" ? rep.mint : USDC_MINT,
      wallet: body.wallet ?? null,
      maxSlippageBps: body.maxSlippageBps ?? null,
    };
    const started = this.now();
    const policy = this.deps.policy ?? DEFAULT_EXECUTION_POLICY;
    const result = await quoteRepresentation(request, {
      adapters: this.deps.adapters,
      connection: this.deps.connection,
      telemetry: this.deps.telemetry ?? null,
      now: () => this.now(),
      deadlineMs: body.deadlineMs,
      // The path is sized on the floors the guard will set, so both must
      // come from the same policy; the guard's verdict is re-checked below.
      pathFloors: {
        intermediateHopBps: policy.intermediateHopSlippageBps,
        representationHopBps: (impact) => effectiveSlippageBps(policy, impact, body.maxSlippageBps ?? null).slippageBps,
      },
    });
    for (const q of [result.best, ...result.alternatives]) if (q) this.deps.health?.recordQuote(q.venue, true, result.latencyMs[q.venue] ?? this.now() - started);
    for (const x of result.exclusions) this.deps.health?.recordQuote(x.venue, false, result.latencyMs[x.venue] ?? 0);

    const reference = (await this.deps.reference?.(rep.id)) ?? null;
    const currentSlot = (await this.deps.currentSlot?.()) ?? result.slot;
    const guarded = guardResult(result, this.deps.policy ?? DEFAULT_EXECUTION_POLICY, {
      now: this.now(),
      currentSlot,
      reference,
      representationDecimals: rep.decimals,
      userMaxSlippageBps: body.maxSlippageBps ?? null,
      allowLegacyExecution: false,
    });
    const bestApproved = guarded.selected;
    let selected = selectRoute(guarded.verdicts) ?? bestApproved;
    let chosen: RankedQuote | null = selected?.quote ?? result.best;
    // Split route (Task 12): every leg must pass the guard on its own; the
    // route is used only if it still beats the best approved single venue.
    let legVerdicts: GuardVerdict[] | null = null;
    let routeLegs: { venue: string; poolAddress: string | null; percentBps: number }[] | null = null;
    /* The Henar construction is reported whenever it is safe and worth
       something, not only when it wins. A caller ranking every source needs
       to see it in third place as readily as in first; hiding a losing
       construction is how the product ended up looking like a wrapper around
       whichever venue won. */
    let henarRoute: QuoteApiResponse["henarRoute"] = null;
    if (result.route?.kind === "split") {
      const verdicts = result.route.legs.map((leg) => guardQuote(leg, this.deps.policy ?? DEFAULT_EXECUTION_POLICY, { now: this.now(), currentSlot, reference, representationDecimals: rep.decimals, userMaxSlippageBps: body.maxSlippageBps ?? null, allowLegacyExecution: false }));
      const allApproved = verdicts.every((v) => v.approved);
      const splitNet = fromRaw(result.route.netOutput);
      const total = fromRaw(result.route.fees.venueInput);
      /* Shares truncate per leg and would display as 86.53% + 13.46% = 99.99%.
         The last leg carries the remainder, as the amounts do. */
      let assignedBps = 0;
      const legs = result.route.legs.map((leg, index) => {
        const share = index === result.route!.legs.length - 1 ? 10_000 - assignedBps : Number((fromRaw(leg.fees.venueInput) * 10_000n) / total);
        assignedBps += share;
        return { venue: leg.venue, poolAddress: leg.poolAddress, percentBps: share };
      });
      if (allApproved) {
        const legFloor = verdicts.reduce((sum, v) => sum + fromRaw(v.minimumAmountOut ?? "0"), 0n);
        henarRoute = {
          legs,
          netOutput: result.route.netOutput,
          minNetUserOutput: (body.side === "sell" ? legFloor - (legFloor * BigInt(result.route.fees.henarFeeBps)) / 10_000n : legFloor).toString(),
          improvementBps: result.route.improvementBps,
          costBps: result.route.costBps,
          priceImpactBps: result.route.legs.reduce<number | null>((worst, leg) => (leg.priceImpactBps === null ? worst : worst === null ? leg.priceImpactBps : Math.max(worst, leg.priceImpactBps)), null),
          executable: true,
        };
      }
      // It is selected only when it actually beats the best approved
      // executable quote: reporting it and choosing it are different things.
      if (allApproved && (!selected || selected.mode !== "execute" || splitNet > fromRaw(selected.quote.netOutput))) {
        legVerdicts = verdicts;
        routeLegs = legs;
        // Represent the route by its first leg for single-quote fields; totals come from the route.
        selected = verdicts[0];
        chosen = result.route.legs[0];
      }
    }
    /* The path is guarded leg by leg with its hop role, then checked for the
       one property the engine assumed: the guard's floor on the USDC-side hop
       is exactly what the other hop was sized on. It is selected only when it
       beats whatever is selected so far, split included. */
    let henarPath: QuoteApiResponse["henarPath"] = null;
    let pathVerdicts: GuardVerdict[] | null = null;
    let routeKind: "single" | "split" | "path" = legVerdicts ? "split" : "single";
    if (result.path?.kind === "path" && result.path.intermediate) {
      const path = result.path;
      const intermediateAsset = result.path.intermediate;
      const intermediate = intermediateAsset.mint;
      const verdicts = path.legs.map((leg) =>
        guardQuote(leg, policy, {
          now: this.now(),
          currentSlot,
          reference,
          representationDecimals: rep.decimals,
          userMaxSlippageBps: body.maxSlippageBps ?? null,
          allowLegacyExecution: false,
          pathLeg: { intermediate, hop: leg.inputMint === USDC_MINT || leg.outputMint === USDC_MINT ? "intermediate" : "representation" },
        }),
      );
      const allApproved = verdicts.every((v) => v.approved && v.mode === "execute");
      const floorsAgree = (() => {
        // Buy: the USDC hop's floor is what the representation-side legs (one or a split) were sized on, in total.
        if (body.side === "buy") return verdicts[0].minimumAmountOut === path.legs.slice(1).reduce((s, l) => s + fromRaw(l.amountIn), 0n).toString();
        const repLegs = verdicts.slice(0, -1);
        const floor = repLegs.reduce((s, v) => s + fromRaw(v.minimumAmountOut ?? "0"), 0n);
        return floor.toString() === path.legs[path.legs.length - 1].amountIn;
      })();
      const executable = allApproved && floorsAgree;
      const minNet = executable
        ? body.side === "buy"
          ? verdicts.slice(1).reduce((s, v) => s + fromRaw(v.minimumAmountOut!), 0n)
          : (() => { const m = fromRaw(verdicts[verdicts.length - 1].minimumAmountOut!); return m - bpsOf(m, path.fees.henarFeeBps); })()
        : null;
      const total = fromRaw(path.fees.venueInput);
      henarPath = {
        legs: path.legs.map((leg) => ({ venue: leg.venue, poolAddress: leg.poolAddress, inputMint: leg.inputMint, outputMint: leg.outputMint, amountIn: leg.amountIn, expectedAmountOut: leg.expectedAmountOut, percentBps: leg.inputMint === path.fees.inputMint && total > 0n ? Number((fromRaw(leg.amountIn) * 10_000n) / total) : 10_000 })),
        intermediate: { mint: intermediateAsset.mint, symbol: intermediateAsset.symbol, decimals: intermediateAsset.decimals },
        residual: path.residual ? { mint: path.residual.mint, expected: path.residual.expected } : null,
        netOutput: path.netOutput,
        minNetUserOutput: minNet === null ? null : minNet.toString(),
        improvementBps: path.improvementBps,
        executable,
        reason: executable ? null : !allApproved ? (verdicts.find((v) => !v.approved)?.reason ?? "leg is quote-only") : "guard floor on the first hop differs from the amount the path was sized on",
        failedChecks: verdicts.map((v, leg) => ({ leg, venue: v.quote.venue, checks: v.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) })).filter((f) => f.checks.length),
      };
      const incumbent = legVerdicts ? fromRaw(result.route!.netOutput) : selected && selected.mode === "execute" ? fromRaw(selected.quote.netOutput) : null;
      if (executable && (incumbent === null || fromRaw(path.netOutput) > incumbent)) {
        pathVerdicts = verdicts;
        legVerdicts = null;
        routeKind = "path";
        routeLegs = henarPath.legs.map((l) => ({ venue: l.venue, poolAddress: l.poolAddress, percentBps: l.percentBps, inputMint: l.inputMint, outputMint: l.outputMint }));
        selected = verdicts[0];
        chosen = path.legs[0];
      }
    }
    const route = result.route && legVerdicts ? result.route : null;
    const pathRoute = routeKind === "path" ? result.path : null;
    const quoteId = createHash("sha256").update(JSON.stringify({ request, at: result.quotedAt, venue: chosen?.venue ?? null, out: chosen?.netOutput ?? null })).digest("hex").slice(0, 32);
    const legExpiry = (pathRoute ?? route)?.legs.reduce((min, l) => Math.min(min, Date.parse(l.expiresAt)), Infinity) ?? Infinity;
    const expiresAt = new Date(Math.min(this.now() + (this.deps.quoteTtlMs ?? 10_000), chosen ? Date.parse(chosen.expiresAt) : Infinity, legExpiry)).toISOString();
    const response: QuoteApiResponse = {
      quoteId,
      company: rep.equityId,
      representation: { id: rep.id, provider: rep.provider, symbol: rep.tokenSymbol, mint: rep.mint, decimals: rep.decimals },
      issuer: rep.provider,
      side: body.side,
      amountIn: body.amount,
      expectedOutput: pathRoute ? pathRoute.fees.grossVenueOutput : route ? route.fees.grossVenueOutput : (chosen?.fees.grossVenueOutput ?? null),
      minOutput: pathRoute ? (body.side === "buy" ? henarPath!.minNetUserOutput : pathVerdicts![pathVerdicts!.length - 1].minimumAmountOut) : route ? legVerdicts!.reduce((s, v) => s + fromRaw(v.minimumAmountOut!), 0n).toString() : (selected?.minimumAmountOut ?? null),
      netUserOutput: pathRoute ? pathRoute.netOutput : route ? route.netOutput : (chosen?.netOutput ?? null),
      minNetUserOutput: pathRoute ? henarPath!.minNetUserOutput : route ? (() => { const m = legVerdicts!.reduce((s, v) => s + fromRaw(v.minimumAmountOut!), 0n); return (body.side === "sell" ? m - (m * BigInt(route.fees.henarFeeBps)) / 10_000n : m).toString(); })() : (selected?.minimumNetUserOutput ?? null),
      effectivePrice: pathRoute ? pathEffectivePrice(pathRoute, body.side, rep.decimals) : effectivePrice(chosen, body.side, rep.decimals),
      fees: pathRoute
        ? { henarBps: pathRoute.fees.henarFeeBps, henarAmount: body.side === "buy" ? pathRoute.fees.henarInputFee : pathRoute.fees.henarOutputFee, henarMint: USDC_MINT, venueFeeAmount: null }
        : chosen ? { henarBps: chosen.henarFeeBps, henarAmount: chosen.henarFeeAmount, henarMint: chosen.henarFeeMint, venueFeeAmount: chosen.venueFeeAmount } : null,
      priceImpactBps: pathRoute ? pathRoute.legs.reduce<number | null>((worst, leg) => (leg.priceImpactBps === null ? worst : worst === null ? leg.priceImpactBps : Math.max(worst, leg.priceImpactBps)), null) : (chosen?.priceImpactBps ?? null),
      expiresAt,
      route: routeLegs ?? (chosen ? [{ venue: chosen.venue, poolAddress: chosen.poolAddress, percentBps: 10_000 }] : null),
      routeKind: routeLegs || chosen ? routeKind : null,
      henarRoute,
      henarRouteReason: result.splitReason,
      henarPath,
      henarPathReason: result.pathReason,
      latencyMs: result.latencyMs as Record<string, number>,
      alternatives: guarded.verdicts.filter((v) => v !== selected).map((v) => ({ venue: v.quote.venue, netOutput: v.quote.netOutput, priceImpactBps: v.quote.priceImpactBps, approved: v.approved, reason: v.reason, failedChecks: v.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) })),
      benchmarkRoutePlan: (guarded.verdicts.find((v) => v.quote.venue === "jupiter")?.quote.rawRouteMetadata as { route?: unknown } | null)?.route ?? null,
      exclusions: result.exclusions.map((x) => ({ venue: x.venue, reason: x.reason, detail: x.detail })),
      executionProtection: selected
        ? { mode: selected.mode, slippageBps: selected.slippageBps, checks: selected.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })), policy: "DEFAULT_EXECUTION_POLICY" }
        : guarded.verdicts[0]
          ? { mode: "refused", slippageBps: null, checks: guarded.verdicts[0].checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })), policy: "DEFAULT_EXECUTION_POLICY" }
          : null,
      verification: chosen ? { poolVerification: chosen.poolAddress ? (poolByAddress(chosen.poolAddress)?.verification ?? null) : null, onchainCheckedAtQuote: chosen.onchainCheckedAtQuote, calculatorStatus: chosen.venue === "meteora-dbc" || chosen.venue === "meteora-damm-v2" ? "SDK_BACKED" : "LIVE_VALIDATION_PENDING" } : null,
      unavailableReason: chosen ? (selected ? null : (guarded.verdicts[0]?.reason ?? null)) : (result.exclusions[0]?.reason ?? "NO_VERIFIED_POOL"),
      comparison: guarded.verdicts.length
        ? guarded.verdicts.map((v) => ({
            venue: v.quote.venue,
            poolAddress: v.quote.poolAddress,
            netOutput: v.quote.netOutput,
            priceImpactBps: v.quote.priceImpactBps,
            approved: v.approved,
            mode: v.mode ?? null,
            reason: v.reason,
            selected: v === selected,
            capability: capabilityOf(v),
            quotedAt: v.quote.quotedAt,
            stateSlot: v.quote.slot ?? null,
          }))
        : null,
      bestQuote: bestApproved
        ? { venue: bestApproved.quote.venue, netOutput: bestApproved.quote.netOutput, executable: bestApproved.mode === "execute" || bestApproved.quote.venue === "jupiter", via: bestApproved.mode === "execute" ? "henar-router" : bestApproved.quote.venue === "jupiter" ? "review-swap" : "none" }
        : null,
      liveValidation: "LIVE_VALIDATION_PENDING",
    };
    this.cache.set(quoteId, { response, verdict: selected, legVerdicts: pathVerdicts ?? legVerdicts, routeKind, path: pathRoute, result, expiresAt: Date.parse(expiresAt) });
    return { status: 200, body: response };
  }

  async build(body: { quoteId: string; owner: string }): Promise<{ status: number; body: unknown }> {
    if (!flagEnabled("routerExecution")) return { status: 403, body: { error: "HENAR_ROUTER_EXECUTION is off", liveValidation: "LIVE_VALIDATION_PENDING" } };
    const cached = this.cache.get(body.quoteId);
    if (!cached) return { status: 404, body: { error: "unknown or expired quoteId" } };
    if (cached.expiresAt < this.now()) return { status: 410, body: { error: "quote expired" } };
    if (!cached.verdict?.approved) return { status: 409, body: { error: "quote was not approved for execution", reason: cached.verdict?.reason ?? cached.response.unavailableReason } };
    if (cached.verdict.mode !== "execute") return { status: 409, body: { error: "quote is quote-only; no validated execution path", mode: cached.verdict.mode } };
    if (!this.deps.treasuryOwner || !this.deps.blockhash || !this.deps.legBuilder) return { status: 503, body: { error: "builder dependencies not configured" } };
    const rep = routerRepresentation(cached.response.representation.id);
    if (!rep || rep.decimals === null || !rep.tokenProgram) return { status: 409, body: { error: "representation decimals/token program not verified on chain" } };
    try {
      const plan = planExecution({
        representation: { id: rep.id, provider: rep.provider, mint: rep.mint, decimals: rep.decimals, tokenProgram: rep.tokenProgram },
        side: cached.response.side,
        owner: body.owner,
        treasuryOwner: this.deps.treasuryOwner,
        userInput: fromRaw(cached.response.amountIn),
        legs: (cached.legVerdicts ?? [cached.verdict]).map((verdict) => ({ verdict })),
        ...pathPlanInput(cached),
        policy: this.deps.policy ?? DEFAULT_EXECUTION_POLICY,
        now: this.now(),
      });
      const built = await buildTransaction(plan, { blockhash: this.deps.blockhash, legBuilder: this.deps.legBuilder, now: this.now() });
      if (!built.ok) return { status: 409, body: { error: built.detail, reason: built.reason } };
      return { status: 200, body: { planId: plan.planId, transaction: Buffer.from(built.built.transaction.serialize()).toString("base64"), blockhash: built.built.blockhash, lastValidBlockHeight: built.built.lastValidBlockHeight, legFloors: built.built.legFloors, minimumAmountOut: plan.totals.minimumAmountOut, expiresAt: plan.expiresAt } };
    } catch (error) {
      return { status: 409, body: { error: (error as Error).message } };
    }
  }

  /**
   * Stateless quote → guard → plan → build for one request. Used by the
   * Next.js route because serverless instances share no quote cache: the
   * quote is taken fresh, guarded, and built in the same call, and the
   * response carries the plan the client validates against before signing.
   */
  async quoteAndBuild(body: QuoteApiRequest & { owner: string }): Promise<{ status: number; body: unknown }> {
    if (!flagEnabled("routerExecution")) return { status: 403, body: { error: "HENAR_ROUTER_EXECUTION is off", liveValidation: "LIVE_VALIDATION_PENDING" } };
    if (!this.deps.treasuryOwner || !this.deps.blockhash || !this.deps.legBuilder) return { status: 503, body: { error: "builder dependencies not configured" } };
    const quoted = await this.quote(body);
    if (quoted.status !== 200) return quoted;
    const q = quoted.body as QuoteApiResponse;
    const cached = this.cache.get(q.quoteId);
    if (!cached?.verdict?.approved) return { status: 409, body: { error: "quote was not approved for execution", reason: cached?.verdict?.reason ?? q.unavailableReason, quote: q } };
    if ((cached.legVerdicts ?? [cached.verdict]).some((v) => v.mode !== "execute")) return { status: 409, body: { error: "quote is quote-only; no validated execution path", mode: cached.verdict.mode, quote: q } };
    const rep = routerRepresentation(q.representation.id);
    if (!rep) return { status: 404, body: { error: "unknown representation" } };
    let decimals = rep.decimals;
    let tokenProgram = rep.tokenProgram;
    if ((decimals === null || !tokenProgram) && this.deps.connection) {
      const inspected = await inspectMint(this.deps.connection, rep.mint);
      if (!inspected || !inspected.supported) return { status: 409, body: { error: `representation mint not supported: ${inspected?.unsupportedReason ?? "missing"}` } };
      decimals = inspected.decimals;
      tokenProgram = inspected.program;
    }
    if (decimals === null || !tokenProgram) return { status: 409, body: { error: "representation decimals/token program not verified on chain" } };
    try {
      const plan = planExecution({
        representation: { id: rep.id, provider: rep.provider, mint: rep.mint, decimals, tokenProgram },
        side: body.side,
        owner: body.owner,
        treasuryOwner: this.deps.treasuryOwner,
        userInput: fromRaw(body.amount),
        legs: (cached.legVerdicts ?? [cached.verdict]).map((verdict) => ({ verdict })),
        ...pathPlanInput(cached),
        policy: this.deps.policy ?? DEFAULT_EXECUTION_POLICY,
        now: this.now(),
      });
      const built = await buildTransaction(plan, { blockhash: this.deps.blockhash, legBuilder: this.deps.legBuilder, now: this.now() });
      if (!built.ok) return { status: 409, body: { error: built.detail, reason: built.reason, quote: q } };
      /* Simulation gate. The floor inside the venue instruction protects the
         user on chain; this protects them from being asked to sign something
         that cannot land, and it is the only place the whole transaction is
         exercised before a signature. A refusal carries the simulation so the
         caller can see which stage failed, never a bare "no". */
      let simulation: SimulationSummary | null = null;
      if (this.deps.simulator) {
        const gate = await gateSimulation(this.deps.simulator, built.built.transaction, plan, this.now());
        this.deps.health?.recordSimulation(gate.ok);
        simulation = gate.simulation;
        if (!gate.ok) return { status: 409, body: { error: gate.error, reason: "SIMULATION_FAILED", quote: q, simulation } };
      }
      this.deps.health?.recordExecution(true);
      return {
        status: 200,
        body: {
          quote: q,
          simulation,
          plan: {
            planId: plan.planId,
            side: plan.side,
            owner: plan.owner,
            kind: plan.kind,
            intermediate: plan.intermediate,
            residual: cached.path?.residual ?? null,
            legs: plan.legs.map((l) => ({ venue: l.venue, poolAddress: l.poolAddress, programId: l.programId, inputMint: l.inputMint, outputMint: l.outputMint, amountIn: l.amountIn, expectedAmountOut: l.expectedAmountOut, minimumAmountOut: l.minimumAmountOut })),
            totals: plan.totals,
            henarFee: plan.henarFee,
            requiredAtas: plan.requiredAtas,
            requiredPrograms: plan.requiredPrograms,
            slippageBps: plan.slippageBps,
            expiresAt: plan.expiresAt,
          },
          transaction: Buffer.from(built.built.transaction.serialize()).toString("base64"),
          blockhash: built.built.blockhash,
          lastValidBlockHeight: built.built.lastValidBlockHeight,
          legFloors: built.built.legFloors,
        },
      };
    } catch (error) {
      return { status: 409, body: { error: (error as Error).message } };
    }
  }

  async submit(): Promise<{ status: number; body: unknown }> {
    return { status: 501, body: { error: "submission is not enabled; LIVE_VALIDATION_PENDING" } };
  }

  /** Test/introspection helper. */
  cachedQuote(quoteId: string) {
    return this.cache.get(quoteId) ?? null;
  }
}

export type SimulationSummary = ReturnType<typeof summarizeSimulation>;

/**
 * Plan inputs that only a path carries. The intermediate's decimals and
 * token program come from the measured intermediate artifact, which was read
 * from chain when the asset qualified; a path through an asset that is not in
 * it cannot be planned.
 */
function pathPlanInput(cached: CachedQuote): { kind: "parallel" | "path"; intermediate: { mint: string; decimals: number; tokenProgram: string } | null } {
  if (cached.routeKind !== "path" || !cached.path?.intermediate) return { kind: "parallel", intermediate: null };
  const record = intermediateRecord(cached.path.intermediate.mint);
  if (!record?.qualified) throw new Error("path intermediate is not a qualified asset");
  return { kind: "path", intermediate: { mint: record.mint, decimals: record.decimals, tokenProgram: record.tokenProgram } };
}

/**
 * Simulate a built transaction and decide whether it may be handed to a
 * wallet. Passes only when the simulation ran without error AND verified the
 * user's output against the plan floor; an unverified output (post state not
 * returned) is a refusal, not a pass.
 */
export async function gateSimulation(
  simulator: Simulator,
  transaction: Parameters<Simulator["simulate"]>[0],
  plan: Parameters<Simulator["simulate"]>[1],
  now: number,
): Promise<{ ok: boolean; error: string | null; simulation: SimulationSummary | null }> {
  let normalized: ReturnType<typeof normalizeSimulation>;
  try {
    normalized = normalizeSimulation(await simulator.simulate(transaction, plan), plan, now);
  } catch (error) {
    return { ok: false, error: `simulation failed: ${(error as Error).message}`, simulation: null };
  }
  const simulation = summarizeSimulation(normalized);
  if (!normalized.ok) return { ok: false, error: normalized.error ?? "simulation failed", simulation };
  if (normalized.outputWithinPlan !== true)
    return { ok: false, error: "simulation did not verify the user's output against the plan floor", simulation };
  return { ok: true, error: null, simulation };
}

function summarizeSimulation(s: ReturnType<typeof normalizeSimulation>) {
  return {
    ok: s.ok,
    error: s.error,
    simulatedOutput: s.simulatedOutput,
    expectedOutput: s.expectedOutput,
    minimumOutput: s.minimumOutput,
    outputWithinPlan: s.outputWithinPlan,
    computeUnitsConsumed: s.computeUnitsConsumed,
    slot: s.slot,
    live: s.live,
    simulatedAt: s.simulatedAt,
  };
}

function pathEffectivePrice(path: RankedRoute, side: "buy" | "sell", decimals: number | null): string | null {
  if (decimals === null) return null;
  const usdc = side === "buy" ? fromRaw(path.fees.userInput) : fromRaw(path.fees.netUserOutput);
  const shares = side === "buy" ? fromRaw(path.fees.grossVenueOutput) : fromRaw(path.fees.userInput);
  if (shares === 0n) return null;
  const scaled = (usdc * 10n ** BigInt(decimals) * 1_000_000n) / (shares * 1_000_000n);
  const s = scaled.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}

function effectivePrice(q: RankedQuote | null, side: "buy" | "sell", decimals: number | null): string | null {
  if (!q || decimals === null) return null;
  const usdc = side === "buy" ? fromRaw(q.fees.userInput) : fromRaw(q.fees.netUserOutput);
  const shares = side === "buy" ? fromRaw(q.fees.grossVenueOutput) : fromRaw(q.fees.userInput);
  if (shares === 0n) return null;
  // USDC per share with 6 decimals of precision, integer math.
  const scaled = (usdc * 10n ** BigInt(decimals) * 1_000_000n) / (shares * 1_000_000n);
  const s = scaled.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}
