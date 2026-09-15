/**
 * Henar Execution Guard (Task 9).
 *
 * Sits between a ranked quote and any transaction. Every check is explicit,
 * every failure is a structured `UnavailableReason`, and the output is a
 * verdict with the exact `minimumAmountOut` a builder may use — computed
 * once, here, and never widened downstream.
 *
 * Venue coverage: Jupiter (legacy /api/market path), Raydium CLMM, Meteora
 * DLMM, Meteora DBC, Meteora DAMM v2. Venue-specific facts are read from the
 * metadata the adapters already put on the quote (`rawRouteMetadata.kind`),
 * so DBC lifecycle / graduation and DAMM v2 status feed this guard rather
 * than a second safety system.
 *
 * What lives here (system-wide): slippage policy, price-impact ceiling,
 * quote/state freshness, reference-price divergence and market session,
 * liquidity floor, registry verification state, execution-path capability,
 * cross-venue and company-level selection rules.
 * What does not: quoting, building, submission (Tasks 13–17).
 */
import {
  bpsOf,
  fromRaw,
  isOnchainVerified,
  poolByAddress,
  routerRepresentation,
  toRaw,
  USDC_MINT,
  type DammV2QuoteMetadata,
  type DbcQuoteMetadata,
  type EngineResult,
  type ExecutionPolicy,
  type PoolRegistry,
  type RankedQuote,
  type RawAmount,
  type ReferencePrice,
  type UnavailableReason,
  type Venue,
} from "@henar/router-core";

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  baseSlippageBps: 30,
  slippagePerImpactBps: 0.5,
  maxSlippageBps: 100,
  maxPriceImpactBps: 150,
  maxQuoteAgeMs: 15_000,
  maxStateAgeSlots: 30,
  minLiquidityUsd: 1_000,
  maxReferenceDivergenceBps: 200,
  maxReferenceAgeMs: 60_000,
  requireReferencePrice: false,
  requireOpenSession: false,
  requireOnchainVerifiedPool: true,
  dbcMaxGraduationProgressBps: 9_800,
  maxLegs: 2,
  minSplitImprovementBps: 5,
};

export type GuardCheck = {
  name: string;
  ok: boolean;
  reason: UnavailableReason | null;
  detail: string;
};

export type GuardVerdict = {
  /** True only when every check passed. Nothing may execute otherwise. */
  approved: boolean;
  /** "execute" when an execution path exists and all checks pass; "quote-only" when the quote is sound but cannot be built yet. */
  mode: "execute" | "quote-only" | "refused";
  quote: RankedQuote;
  policy: ExecutionPolicy;
  /** Effective slippage (bps) actually applied; never above policy or user max. */
  slippageBps: number | null;
  /** The floor a builder must enforce on chain. Null when refused. */
  minimumAmountOut: RawAmount | null;
  /** User-facing net minimum after the Henar output fee, when applicable. */
  minimumNetUserOutput: RawAmount | null;
  checks: GuardCheck[];
  /** First failing reason, for callers that need one code. */
  reason: UnavailableReason | null;
  evaluatedAt: string;
};

export type GuardContext = {
  now: number;
  /** Current confirmed slot, if the caller has one; null skips the slot-age check only when the policy allows (it does not by default). */
  currentSlot: number | null;
  reference: ReferencePrice | null;
  /** Decimals of the representation, for the reference comparison. */
  representationDecimals: number | null;
  registry?: PoolRegistry;
  /** Set true for the legacy /api/market path, which builds and validates its own transaction. */
  allowLegacyExecution?: boolean;
  /** The user's own slippage ceiling from the request; may only tighten policy. */
  userMaxSlippageBps?: number | null;
};

const USDC_DECIMALS = 6n;

function check(name: string, ok: boolean, reason: UnavailableReason, detail: string): GuardCheck {
  return { name, ok, reason: ok ? null : reason, detail };
}

/**
 * Dynamic slippage: base + impact × factor, clamped to the policy ceiling and
 * the user's own ceiling. Returns null when the required slippage exceeds
 * either ceiling — the caller refuses rather than widening.
 */
export function effectiveSlippageBps(
  policy: ExecutionPolicy,
  priceImpactBps: number | null,
  userMaxSlippageBps: number | null | undefined,
): { slippageBps: number | null; required: number } {
  const impact = Math.max(0, priceImpactBps ?? 0);
  const required = Math.ceil(policy.baseSlippageBps + impact * policy.slippagePerImpactBps);
  const ceiling = Math.min(policy.maxSlippageBps, userMaxSlippageBps ?? policy.maxSlippageBps);
  return { slippageBps: required <= ceiling ? required : null, required };
}

/** Floor rounding: minOut = expected × (1 − slippage). */
export function minimumOutFor(expected: bigint, slippageBps: number) {
  return expected - bpsOf(expected, slippageBps);
}

/**
 * Venue price expressed as USDC per one display unit of the representation,
 * as a rational (num/den) so it can be compared with the reference in bps
 * without floats.
 */
function venueUsdcPerShare(
  quote: RankedQuote,
  side: "buy" | "sell",
  representationDecimals: number,
): { num: bigint; den: bigint } | null {
  const usdc = side === "buy" ? fromRaw(quote.fees.venueInput) : fromRaw(quote.fees.grossVenueOutput);
  const shares = side === "buy" ? fromRaw(quote.fees.grossVenueOutput) : fromRaw(quote.fees.venueInput);
  if (usdc <= 0n || shares <= 0n) return null;
  // price = (usdc / 1e6) / (shares / 1e^dec) = usdc × 10^dec / (shares × 10^6)
  return { num: usdc * 10n ** BigInt(representationDecimals), den: shares * 10n ** USDC_DECIMALS };
}

/** Parse a decimal string into num/den without floats. */
function decimalToRational(value: string): { num: bigint; den: bigint } | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  return { num: BigInt(m[1] + frac), den: 10n ** BigInt(frac.length) };
}

/** |a − b| / b in bps for rationals. */
function divergenceBps(a: { num: bigint; den: bigint }, b: { num: bigint; den: bigint }) {
  const left = a.num * b.den;
  const right = b.num * a.den;
  const diff = left > right ? left - right : right - left;
  if (right === 0n) return null;
  return Number((diff * 10_000n) / right);
}

function metaKind(quote: RankedQuote) {
  const meta = quote.rawRouteMetadata as { kind?: string } | null;
  return meta?.kind ?? null;
}

function venueChecks(quote: RankedQuote, policy: ExecutionPolicy): GuardCheck[] {
  const checks: GuardCheck[] = [];
  const kind = metaKind(quote);
  switch (quote.venue) {
    case "meteora-dbc": {
      const meta = kind === "meteora-dbc" ? (quote.rawRouteMetadata as DbcQuoteMetadata) : null;
      checks.push(check("dbc.metadata", meta !== null, "INVALID_REQUEST", meta ? "DBC metadata present" : "DBC quote without DBC metadata"));
      if (!meta) break;
      checks.push(check("dbc.lifecycle", meta.lifecycleState === "BONDING", meta.lifecycleState === "GRADUATED" ? "POOL_GRADUATED" : meta.lifecycleState === "MIGRATING" ? "ROUTE_MIGRATING" : "POOL_INACTIVE", `lifecycle ${meta.lifecycleState}`));
      checks.push(
        check(
          "dbc.graduationHeadroom",
          meta.graduationProgressBps <= policy.dbcMaxGraduationProgressBps,
          "ROUTE_MIGRATING",
          `graduation progress ${meta.graduationProgressBps} bps (limit ${policy.dbcMaxGraduationProgressBps})`,
        ),
      );
      checks.push(check("dbc.migrationVenue", meta.expectedMigrationVenue === "meteora-damm-v2", "CORPORATE_ACTION_PENDING", `migration option ${meta.migrationOption ?? "unknown"}`));
      checks.push(check("dbc.mints", Boolean(meta.baseMint?.supported && meta.quoteMint?.supported), "UNSUPPORTED_TOKEN_EXTENSION", meta.baseMint?.unsupportedReason ?? meta.quoteMint?.unsupportedReason ?? "mints supported"));
      break;
    }
    case "meteora-damm-v2": {
      const meta = kind === "meteora-damm-v2" ? (quote.rawRouteMetadata as DammV2QuoteMetadata) : null;
      checks.push(check("dammV2.metadata", meta !== null, "INVALID_REQUEST", meta ? "DAMM v2 metadata present" : "DAMM v2 quote without metadata"));
      if (!meta) break;
      checks.push(check("dammV2.status", meta.poolStatus === "Enable", "POOL_INACTIVE", `pool status ${meta.poolStatus ?? "unknown"}`));
      checks.push(check("dammV2.mints", Boolean(meta.tokenA?.supported && meta.tokenB?.supported), "UNSUPPORTED_TOKEN_EXTENSION", meta.tokenA?.unsupportedReason ?? meta.tokenB?.unsupportedReason ?? "mints supported"));
      break;
    }
    case "raydium":
    case "meteora":
      checks.push(check(`${quote.venue}.onchainChecked`, quote.onchainCheckedAtQuote, "ROUTE_STATE_STALE", quote.onchainCheckedAtQuote ? "mints re-read at quote time" : "quote did not re-check chain state"));
      break;
    case "jupiter":
      checks.push(check("jupiter.path", quote.executionPath === "legacy-market-api", "NOT_IMPLEMENTED", `execution path ${quote.executionPath}`));
      break;
    default:
      checks.push(check("venue.known", false, "VENUE_NOT_CONFIGURED", `no guard rules for venue ${quote.venue as Venue}`));
  }
  return checks;
}

/**
 * Evaluate one ranked quote against policy and context. Pure apart from the
 * registry lookup.
 */
export function guardQuote(quote: RankedQuote, policy: ExecutionPolicy, ctx: GuardContext): GuardVerdict {
  const checks: GuardCheck[] = [];
  const side = quote.henarFeeMint === quote.inputMint ? "buy" : "sell";

  // 1. Quote is an available quote for the supported pair.
  checks.push(check("quote.available", quote.unavailableReason === null, quote.unavailableReason ?? "INVALID_REQUEST", quote.unavailableDetail ?? "available"));
  const rep = routerRepresentation(quote.representationId);
  checks.push(check("representation.active", rep?.status === "ACTIVE", "REPRESENTATION_RESTRICTED", rep ? `representation ${rep.status}` : "unknown representation"));
  const pairOk = rep !== null && new Set([quote.inputMint, quote.outputMint]).has(USDC_MINT) && new Set([quote.inputMint, quote.outputMint]).has(rep.mint);
  checks.push(check("scope.usdcEquity", pairOk, "INVALID_REQUEST", pairOk ? "USDC ↔ verified representation" : "pair is outside router scope"));

  // 2. Freshness.
  const ageMs = ctx.now - Date.parse(quote.quotedAt);
  checks.push(check("quote.age", ageMs <= policy.maxQuoteAgeMs && ctx.now <= Date.parse(quote.expiresAt), "QUOTE_EXPIRED", `quote is ${ageMs}ms old`));
  if (quote.venue !== "jupiter") {
    const slotOk = quote.slot !== null && ctx.currentSlot !== null && ctx.currentSlot - quote.slot <= policy.maxStateAgeSlots && ctx.currentSlot >= quote.slot;
    checks.push(check("state.slotAge", slotOk, "ROUTE_STATE_STALE", quote.slot === null ? "quote carries no slot" : ctx.currentSlot === null ? "current slot unknown" : `state is ${ctx.currentSlot - quote.slot} slots old`));
  }

  // 3. Registry pool: eligibility and verification.
  if (quote.venue !== "jupiter") {
    const pool = quote.poolAddress ? poolByAddress(quote.poolAddress, ctx.registry) : null;
    checks.push(check("pool.registered", pool !== null && pool.enabled, "NO_VERIFIED_POOL", pool ? (pool.enabled ? "enabled registry pool" : `pool disabled: ${pool.disabledReason}`) : "pool not in registry"));
    if (pool) {
      checks.push(check("pool.eligibility", pool.eligibility === "ROUTER_ELIGIBLE", "NOT_ROUTER_ELIGIBLE", pool.eligibility));
      checks.push(check("pool.venue", pool.venue === quote.venue, "QUOTE_TERMS_MISMATCH", `registry venue ${pool.venue}`));
      if (policy.requireOnchainVerifiedPool)
        checks.push(check("pool.onchainVerified", isOnchainVerified(pool), "ROUTE_STATE_STALE", `verification ${pool.verification}`));
      const tvl = pool.tvlUsd;
      checks.push(check("pool.liquidity", tvl !== null && tvl >= policy.minLiquidityUsd, "INSUFFICIENT_LIQUIDITY", tvl === null ? "TVL unknown" : `TVL $${Math.round(tvl)}`));
    }
  }

  // 4. Price impact and slippage.
  checks.push(check("price.impact", quote.priceImpactBps !== null && quote.priceImpactBps <= policy.maxPriceImpactBps, "PRICE_IMPACT_TOO_HIGH", quote.priceImpactBps === null ? "impact unknown" : `impact ${quote.priceImpactBps} bps`));
  const slip = effectiveSlippageBps(policy, quote.priceImpactBps, ctx.userMaxSlippageBps);
  checks.push(check("slippage.withinLimits", slip.slippageBps !== null, "SLIPPAGE_LIMIT_EXCEEDED", `required ${slip.required} bps, ceiling ${policy.maxSlippageBps} bps`));

  // 5. Reference price and session.
  const ref = ctx.reference;
  if (policy.requireReferencePrice || ref) {
    if (!ref) checks.push(check("reference.present", false, "REFERENCE_PRICE_STALE", "no reference price"));
    else {
      const refAge = ctx.now - Date.parse(ref.asOf);
      checks.push(check("reference.fresh", refAge <= policy.maxReferenceAgeMs, "REFERENCE_PRICE_STALE", `reference is ${refAge}ms old (${ref.kind}, ${ref.source})`));
      if (policy.requireOpenSession) checks.push(check("session.open", ref.session.status === "open", "CORPORATE_ACTION_PENDING", `session ${ref.session.status}`));
      const decimals = ctx.representationDecimals ?? rep?.decimals ?? null;
      const venuePrice = decimals === null ? null : venueUsdcPerShare(quote, side, decimals);
      const refPrice = decimalToRational(ref.price);
      const div = venuePrice && refPrice ? divergenceBps(venuePrice, refPrice) : null;
      checks.push(check("reference.divergence", div !== null && div <= policy.maxReferenceDivergenceBps, "REFERENCE_PRICE_STALE", div === null ? "cannot compare (decimals unknown)" : `venue price diverges ${div} bps from reference`));
    }
  }

  // 6. Venue-specific.
  checks.push(...venueChecks(quote, policy));

  // 7. Execution path.
  const canExecute = quote.executionPath === "henar-native" || (quote.executionPath === "legacy-market-api" && Boolean(ctx.allowLegacyExecution));
  const failed = checks.filter((c) => !c.ok);
  const reason = failed[0]?.reason ?? null;
  const approved = failed.length === 0;
  const expected = fromRaw(quote.fees.grossVenueOutput);
  const minimumAmountOut = approved && slip.slippageBps !== null ? minimumOutFor(expected, slip.slippageBps) : null;
  const minimumNet = minimumAmountOut === null ? null : side === "sell" ? minimumAmountOut - bpsOf(minimumAmountOut, quote.henarFeeBps) : minimumAmountOut;
  return {
    approved,
    mode: approved ? (canExecute ? "execute" : "quote-only") : "refused",
    quote,
    policy,
    slippageBps: approved ? slip.slippageBps : null,
    minimumAmountOut: minimumAmountOut === null ? null : toRaw(minimumAmountOut),
    minimumNetUserOutput: minimumNet === null ? null : toRaw(minimumNet),
    checks,
    reason,
    evaluatedAt: new Date(ctx.now).toISOString(),
  };
}

/**
 * Apply the guard to a whole engine result: the best quote that passes wins;
 * every quote that fails is reported with its reason. Ranking order is the
 * engine's; the guard never re-ranks on anything but pass/fail.
 */
export function guardResult(result: EngineResult, policy: ExecutionPolicy, ctx: GuardContext) {
  const verdicts = (result.best ? [result.best, ...result.alternatives] : result.alternatives).map((q) => guardQuote(q, policy, ctx));
  const selected = verdicts.find((v) => v.approved) ?? null;
  return { selected, verdicts, refused: verdicts.filter((v) => !v.approved) };
}

/**
 * Company-level rule (plan §9): a sell may only be executed against the
 * representation the user actually holds; buys may compare representations
 * but the winner's issuer is always explicit in the verdict. This helper
 * refuses to pick across representations for sells.
 */
export function selectAcrossRepresentations(
  candidates: { representationId: string; verdict: GuardVerdict }[],
  side: "buy" | "sell",
  heldRepresentationId: string | null,
): { representationId: string; verdict: GuardVerdict } | null {
  const approved = candidates.filter((c) => c.verdict.approved);
  if (side === "sell") {
    if (!heldRepresentationId) return null;
    return approved.find((c) => c.representationId === heldRepresentationId) ?? null;
  }
  return approved.sort((a, b) => (fromRaw(b.verdict.quote.netOutput) > fromRaw(a.verdict.quote.netOutput) ? 1 : -1))[0] ?? null;
}
