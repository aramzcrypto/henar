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
  flagEnabled,
  fromRaw,
  inspectMint,
  poolByAddress,
  quoteRepresentation,
  routerRepresentation,
  type EngineResult,
  type QuoteRequest,
  type RankedQuote,
  type ReferencePrice,
  type TelemetrySink,
  type VenueAdapter,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardResult, type GuardVerdict } from "@henar/execution-guard";
import { buildTransaction, planExecution, type BlockhashProvider, type LegInstructionBuilder } from "@henar/tx-builder";
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
  now?: () => number;
  quoteTtlMs?: number;
};

export type QuoteApiRequest = {
  representationId: string;
  side: "buy" | "sell";
  amount: string;
  wallet?: string | null;
  maxSlippageBps?: number | null;
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
  route: { venue: string; poolAddress: string | null; percentBps: number }[] | null;
  alternatives: { venue: string; netOutput: string; priceImpactBps: number | null; approved: boolean; reason: string | null; failedChecks: string[] }[];
  exclusions: { venue: string; reason: string; detail: string | null }[];
  executionProtection: { mode: "execute" | "quote-only" | "refused"; slippageBps: number | null; checks: { name: string; ok: boolean; detail: string }[]; policy: string } | null;
  verification: { poolVerification: string | null; onchainCheckedAtQuote: boolean | null; calculatorStatus: string } | null;
  unavailableReason: string | null;
  liveValidation: "LIVE_VALIDATION_PENDING";
};

type CachedQuote = { response: QuoteApiResponse; verdict: GuardVerdict | null; result: EngineResult; expiresAt: number };

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
    const result = await quoteRepresentation(request, { adapters: this.deps.adapters, connection: this.deps.connection, telemetry: this.deps.telemetry ?? null, now: () => this.now() });
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
    const selected = guarded.selected;
    const chosen: RankedQuote | null = selected?.quote ?? result.best;
    const quoteId = createHash("sha256").update(JSON.stringify({ request, at: result.quotedAt, venue: chosen?.venue ?? null, out: chosen?.netOutput ?? null })).digest("hex").slice(0, 32);
    const expiresAt = new Date(Math.min(this.now() + (this.deps.quoteTtlMs ?? 10_000), chosen ? Date.parse(chosen.expiresAt) : Infinity)).toISOString();
    const response: QuoteApiResponse = {
      quoteId,
      company: rep.equityId,
      representation: { id: rep.id, provider: rep.provider, symbol: rep.tokenSymbol, mint: rep.mint, decimals: rep.decimals },
      issuer: rep.provider,
      side: body.side,
      amountIn: body.amount,
      expectedOutput: chosen?.fees.grossVenueOutput ?? null,
      minOutput: selected?.minimumAmountOut ?? null,
      netUserOutput: chosen?.netOutput ?? null,
      minNetUserOutput: selected?.minimumNetUserOutput ?? null,
      effectivePrice: effectivePrice(chosen, body.side, rep.decimals),
      fees: chosen ? { henarBps: chosen.henarFeeBps, henarAmount: chosen.henarFeeAmount, henarMint: chosen.henarFeeMint, venueFeeAmount: chosen.venueFeeAmount } : null,
      priceImpactBps: chosen?.priceImpactBps ?? null,
      expiresAt,
      route: chosen ? [{ venue: chosen.venue, poolAddress: chosen.poolAddress, percentBps: 10_000 }] : null,
      alternatives: guarded.verdicts.filter((v) => v !== selected).map((v) => ({ venue: v.quote.venue, netOutput: v.quote.netOutput, priceImpactBps: v.quote.priceImpactBps, approved: v.approved, reason: v.reason, failedChecks: v.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) })),
      exclusions: result.exclusions.map((x) => ({ venue: x.venue, reason: x.reason, detail: x.detail })),
      executionProtection: selected
        ? { mode: selected.mode, slippageBps: selected.slippageBps, checks: selected.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })), policy: "DEFAULT_EXECUTION_POLICY" }
        : guarded.verdicts[0]
          ? { mode: "refused", slippageBps: null, checks: guarded.verdicts[0].checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })), policy: "DEFAULT_EXECUTION_POLICY" }
          : null,
      verification: chosen ? { poolVerification: chosen.poolAddress ? (poolByAddress(chosen.poolAddress)?.verification ?? null) : null, onchainCheckedAtQuote: chosen.onchainCheckedAtQuote, calculatorStatus: chosen.venue === "meteora-dbc" || chosen.venue === "meteora-damm-v2" ? "SDK_BACKED" : "LIVE_VALIDATION_PENDING" } : null,
      unavailableReason: chosen ? (selected ? null : (guarded.verdicts[0]?.reason ?? null)) : (result.exclusions[0]?.reason ?? "NO_VERIFIED_POOL"),
      liveValidation: "LIVE_VALIDATION_PENDING",
    };
    this.cache.set(quoteId, { response, verdict: selected, result, expiresAt: Date.parse(expiresAt) });
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
        legs: [{ verdict: cached.verdict }],
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
    if (cached.verdict.mode !== "execute") return { status: 409, body: { error: "quote is quote-only; no validated execution path", mode: cached.verdict.mode, quote: q } };
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
        legs: [{ verdict: cached.verdict }],
        policy: this.deps.policy ?? DEFAULT_EXECUTION_POLICY,
        now: this.now(),
      });
      const built = await buildTransaction(plan, { blockhash: this.deps.blockhash, legBuilder: this.deps.legBuilder, now: this.now() });
      if (!built.ok) return { status: 409, body: { error: built.detail, reason: built.reason, quote: q } };
      this.deps.health?.recordExecution(true);
      return {
        status: 200,
        body: {
          quote: q,
          plan: {
            planId: plan.planId,
            side: plan.side,
            owner: plan.owner,
            legs: plan.legs.map((l) => ({ venue: l.venue, poolAddress: l.poolAddress, programId: l.programId, amountIn: l.amountIn, expectedAmountOut: l.expectedAmountOut, minimumAmountOut: l.minimumAmountOut })),
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
