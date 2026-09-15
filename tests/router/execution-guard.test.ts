/**
 * Execution Guard across all five venues, offline. Uses mock ranked quotes
 * shaped like the adapters' real output (including DBC / DAMM v2 metadata)
 * and a synthetic registry so pool verification state can be controlled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  USDC_MINT,
  buildPoolRegistry,
  listRouterRepresentations,
  rankQuote,
  unavailableQuote,
  type DbcQuoteMetadata,
  type DammV2QuoteMetadata,
  type EngineResult,
  type QuoteRequest,
  type RankedQuote,
  type ReferencePrice,
  type Venue,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";
import {
  DEFAULT_EXECUTION_POLICY,
  effectiveSlippageBps,
  guardQuote,
  guardResult,
  minimumOutFor,
  selectAcrossRepresentations,
  type GuardContext,
} from "@henar/execution-guard";
import { mintInspection } from "./fixtures/meteora-dbc";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE" && r.decimals !== null) ?? listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const DEC = rep.decimals ?? 8;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const POOL = key(41);
const NOW = 1_800_000_000_000;
const SLOT = 300_000_000;

const buy = (amount = "100000000"): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint });
const sell = (amount = "1000000000"): QuoteRequest => ({ representationId: rep.id, side: "sell", amount, amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT });

function venueQuote(venue: Venue, request: QuoteRequest, out: string, extra: Partial<VenueQuote> = {}): VenueQuote {
  const swapIn = request.side === "buy" ? (BigInt(request.amount) - (BigInt(request.amount) * 15n) / 10_000n).toString() : request.amount;
  return {
    ...unavailableQuote(venue, request, "SDK_ERROR", null, venue === "jupiter" ? null : POOL, NOW),
    amountIn: swapIn,
    expectedAmountOut: out,
    unavailableReason: null,
    unavailableDetail: null,
    priceImpactBps: 10,
    slot: SLOT,
    onchainCheckedAtQuote: venue !== "jupiter",
    executionPath: venue === "jupiter" ? "legacy-market-api" : "none",
    expiresAt: new Date(NOW + 10_000).toISOString(),
    source: `${venue}:test`,
    ...extra,
  };
}

/** 100 USDC buys 20 shares at $5 → 20 × 10^DEC raw. */
const SHARES_FOR_100 = (20n * 10n ** BigInt(DEC)).toString();

function ranked(venue: Venue, request = buy(), out = SHARES_FOR_100, extra: Partial<VenueQuote> = {}): RankedQuote {
  return rankQuote(venueQuote(venue, request, out, extra), request, 15);
}

function pool(venue: Venue, overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  const poolType = venue === "raydium" ? "clmm" : venue === "meteora" ? "dlmm" : venue === "meteora-dbc" ? "dbc" : "damm_v2";
  return {
    id: `${venue}:${POOL}`,
    representationId: rep.id,
    mint: rep.mint,
    provider: rep.provider,
    tokenSymbol: rep.tokenSymbol,
    venue,
    address: POOL,
    programId: key(50),
    poolType,
    baseMint: rep.mint,
    quoteMint: USDC_MINT,
    feeBps: 10,
    feeConfig: null,
    observedTokenPrograms: null,
    tvlUsd: 50_000,
    discoveredFrom: "test",
    discoveredAt: "2026-09-15T00:00:00.000Z",
    verifiedAt: "2026-09-15T00:00:00.000Z",
    verification: "ONCHAIN_VERIFIED",
    onchainVerifiedAt: "2026-09-15T00:00:00.000Z",
    verificationDetail: null,
    eligibility: "ROUTER_ELIGIBLE",
    dbc: poolType === "dbc" ? { configAddress: key(42), lifecycle: "BONDING", lifecycleCheckedAt: null, lifecycleSlot: null, successorStatus: "NOT_APPLICABLE", successorPoolAddress: null, successorConfirmedAt: null } : null,
    enabled: true,
    disabledReason: null,
    ...overrides,
  };
}

function ctx(venue: Venue, poolOverrides: Partial<VerifiedPool> = {}, extra: Partial<GuardContext> = {}): GuardContext {
  return {
    now: NOW,
    currentSlot: SLOT + 5,
    reference: null,
    representationDecimals: DEC,
    registry: buildPoolRegistry(venue === "jupiter" ? [] : [pool(venue, poolOverrides)]),
    ...extra,
  };
}

const dbcMeta = (over: Partial<DbcQuoteMetadata> = {}): DbcQuoteMetadata => ({
  kind: "meteora-dbc",
  poolAddress: POOL,
  configAddress: key(42),
  lifecycleState: "BONDING",
  quoteReserve: "1000",
  baseReserve: "1000",
  migrationQuoteThreshold: "10000",
  graduationProgressBps: 1000,
  currentPrice: "5",
  currentFeeBps: 100,
  baseFeeMode: "FeeSchedulerLinear",
  dynamicFeeEnabled: true,
  collectFeeMode: "QuoteToken",
  activationType: "Timestamp",
  activationPoint: "0",
  currentPoint: "1",
  migrationOption: "MET_DAMM_V2",
  migrationFeeOption: 2,
  expectedMigrationVenue: "meteora-damm-v2",
  successorStatus: "NOT_APPLICABLE",
  successorPoolAddress: null,
  baseMint: mintInspection(rep.mint, DEC, true),
  quoteMint: mintInspection(USDC_MINT, 6, false),
  nextSqrtPrice: null,
  lastStateSlot: SLOT,
  lastUpdatedAt: new Date(NOW).toISOString(),
  ...over,
});

const dammMeta = (over: Partial<DammV2QuoteMetadata> = {}): DammV2QuoteMetadata => ({
  kind: "meteora-damm-v2",
  poolAddress: POOL,
  poolStatus: "Enable",
  activationType: "Timestamp",
  activationPoint: "0",
  currentPoint: "1",
  sqrtPrice: "1",
  sqrtMinPrice: "1",
  sqrtMaxPrice: "2",
  liquidity: "1",
  tokenAAmount: null,
  tokenBAmount: null,
  collectFeeMode: "QuoteToken",
  feeVersion: 1,
  dynamicFeeEnabled: false,
  currentFeeBps: 100,
  tokenA: mintInspection(rep.mint, DEC, true),
  tokenB: mintInspection(USDC_MINT, 6, false),
  nextSqrtPrice: null,
  lastStateSlot: SLOT,
  lastUpdatedAt: new Date(NOW).toISOString(),
  ...over,
});

const failing = (v: ReturnType<typeof guardQuote>) => v.checks.filter((c) => !c.ok).map((c) => c.name);

// ---------------------------------------------------------------------------

test("a sound Raydium quote on a verified pool is approved quote-only (no native builder yet) with a floored minOut", () => {
  const v = guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium"));
  assert.deepEqual(failing(v), []);
  assert.equal(v.approved, true);
  assert.equal(v.mode, "quote-only");
  assert.equal(v.slippageBps, 35); // 30 base + 10 impact × 0.5
  assert.equal(v.minimumAmountOut, minimumOutFor(BigInt(SHARES_FOR_100), 35).toString());
  assert.equal(v.minimumNetUserOutput, v.minimumAmountOut); // buy: no output fee
});

test("Jupiter is approved for execution only when the legacy path is allowed", () => {
  const off = guardQuote(ranked("jupiter"), DEFAULT_EXECUTION_POLICY, ctx("jupiter"));
  assert.equal(off.approved, true);
  assert.equal(off.mode, "quote-only");
  const on = guardQuote(ranked("jupiter"), DEFAULT_EXECUTION_POLICY, ctx("jupiter", {}, { allowLegacyExecution: true }));
  assert.equal(on.mode, "execute");
  const wrongPath = guardQuote(ranked("jupiter", buy(), SHARES_FOR_100, { executionPath: "none" }), DEFAULT_EXECUTION_POLICY, ctx("jupiter"));
  assert.deepEqual(failing(wrongPath), ["jupiter.path"]);
});

test("sell: minimumNetUserOutput deducts the Henar output fee from the on-chain floor", () => {
  const q = ranked("raydium", sell(), "50000000"); // 10 shares → 50 USDC
  const v = guardQuote(q, DEFAULT_EXECUTION_POLICY, ctx("raydium"));
  assert.equal(v.approved, true);
  const floor = BigInt(v.minimumAmountOut!);
  assert.equal(v.minimumNetUserOutput, (floor - (floor * 15n) / 10_000n).toString());
});

test("registry: DISCOVERED pool is refused for execution; disabled, infra, wrong-venue and unknown pools are refused", () => {
  assert.deepEqual(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", { verification: "DISCOVERED", onchainVerifiedAt: null }))), ["pool.onchainVerified"]);
  const relaxed = { ...DEFAULT_EXECUTION_POLICY, requireOnchainVerifiedPool: false };
  assert.equal(guardQuote(ranked("raydium"), relaxed, ctx("raydium", { verification: "DISCOVERED", onchainVerifiedAt: null })).approved, true);
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", { enabled: false, disabledReason: "thin" }))).includes("pool.registered"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", { eligibility: "STOCK_PAIRED_INFRASTRUCTURE", quoteMint: key(60), enabled: false, disabledReason: "infra" }))).includes("pool.eligibility"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("meteora"))).includes("pool.venue"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("jupiter"))).includes("pool.registered"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", { tvlUsd: 500 }))).includes("pool.liquidity"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", { tvlUsd: null }))).includes("pool.liquidity"));
});

test("freshness: expired quote, stale slot, unknown slot, missing chain re-check", () => {
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { now: NOW + 20_000 }))).includes("quote.age"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { currentSlot: SLOT + 31 }))).includes("state.slotAge"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { currentSlot: null }))).includes("state.slotAge"));
  assert.ok(failing(guardQuote(ranked("raydium", buy(), SHARES_FOR_100, { slot: null }), DEFAULT_EXECUTION_POLICY, ctx("raydium"))).includes("state.slotAge"));
  assert.ok(failing(guardQuote(ranked("meteora", buy(), SHARES_FOR_100, { onchainCheckedAtQuote: false }), DEFAULT_EXECUTION_POLICY, ctx("meteora"))).includes("meteora.onchainChecked"));
});

test("slippage is dynamic but never widened past policy or the user's ceiling", () => {
  assert.deepEqual(effectiveSlippageBps(DEFAULT_EXECUTION_POLICY, 0, null), { slippageBps: 30, required: 30 });
  assert.deepEqual(effectiveSlippageBps(DEFAULT_EXECUTION_POLICY, 100, null), { slippageBps: 80, required: 80 });
  assert.deepEqual(effectiveSlippageBps(DEFAULT_EXECUTION_POLICY, 150, null), { slippageBps: null, required: 105 });
  assert.deepEqual(effectiveSlippageBps(DEFAULT_EXECUTION_POLICY, 100, 50), { slippageBps: null, required: 80 });
  assert.deepEqual(effectiveSlippageBps(DEFAULT_EXECUTION_POLICY, 100, 500), { slippageBps: 80, required: 80 }); // user cannot loosen
  const v = guardQuote(ranked("raydium", buy(), SHARES_FOR_100, { priceImpactBps: 149 }), DEFAULT_EXECUTION_POLICY, ctx("raydium"));
  assert.equal(v.reason, "SLIPPAGE_LIMIT_EXCEEDED");
  assert.equal(v.minimumAmountOut, null);
  const user = guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { userMaxSlippageBps: 20 }));
  assert.equal(user.reason, "SLIPPAGE_LIMIT_EXCEEDED");
});

test("price impact above the ceiling or unknown is refused", () => {
  assert.equal(guardQuote(ranked("raydium", buy(), SHARES_FOR_100, { priceImpactBps: 151 }), DEFAULT_EXECUTION_POLICY, ctx("raydium")).reason, "PRICE_IMPACT_TOO_HIGH");
  assert.ok(failing(guardQuote(ranked("raydium", buy(), SHARES_FOR_100, { priceImpactBps: null }), DEFAULT_EXECUTION_POLICY, ctx("raydium"))).includes("price.impact"));
});

test("reference price: divergence, staleness, session, and mandatory presence", () => {
  const ref = (over: Partial<ReferencePrice> = {}): ReferencePrice => ({
    representationId: rep.id,
    price: "5.00",
    currency: "USD",
    source: "test",
    asOf: new Date(NOW - 1000).toISOString(),
    confidence: null,
    kind: "live",
    session: { status: "open", exchange: "XNAS", asOf: new Date(NOW).toISOString(), nextOpen: null, nextClose: null },
    ...over,
  });
  // Venue price: 99.85 USDC / 20 shares = 4.9925 → 15 bps under 5.00
  assert.equal(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { reference: ref() })).approved, true);
  const far = guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { reference: ref({ price: "5.20" }) }));
  assert.ok(failing(far).includes("reference.divergence"));
  assert.match(far.checks.find((c) => c.name === "reference.divergence")!.detail, /diverges 399 bps/);
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { reference: ref({ asOf: new Date(NOW - 120_000).toISOString() }) }))).includes("reference.fresh"));
  const strict = { ...DEFAULT_EXECUTION_POLICY, requireReferencePrice: true, requireOpenSession: true };
  assert.ok(failing(guardQuote(ranked("raydium"), strict, ctx("raydium"))).includes("reference.present"));
  assert.ok(failing(guardQuote(ranked("raydium"), strict, ctx("raydium", {}, { reference: ref({ session: { ...ref().session, status: "closed" } }) }))).includes("session.open"));
  assert.ok(failing(guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium", {}, { reference: ref(), representationDecimals: null }))).includes("reference.divergence"));
});

test("DBC: lifecycle, graduation headroom, migration venue and mint support come from the quote's own metadata", () => {
  const ok = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: dbcMeta() });
  assert.equal(guardQuote(ok, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc")).approved, true);
  const migrating = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: dbcMeta({ lifecycleState: "MIGRATING" }) });
  assert.equal(guardQuote(migrating, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc")).reason, "ROUTE_MIGRATING");
  const graduated = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: dbcMeta({ lifecycleState: "GRADUATED" }) });
  assert.equal(guardQuote(graduated, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc")).reason, "POOL_GRADUATED");
  const nearly = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: dbcMeta({ graduationProgressBps: 9_900 }) });
  const v = guardQuote(nearly, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc"));
  assert.deepEqual(failing(v), ["dbc.graduationHeadroom"]);
  assert.equal(v.reason, "ROUTE_MIGRATING");
  const v1 = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: dbcMeta({ expectedMigrationVenue: null, migrationOption: "MET_DAMM" }) });
  assert.ok(failing(guardQuote(v1, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc"))).includes("dbc.migrationVenue"));
  const hooked = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: dbcMeta({ baseMint: mintInspection(rep.mint, DEC, true, { supported: false, unsupportedReason: "transfer hook" }) }) });
  assert.equal(guardQuote(hooked, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc")).reason, "UNSUPPORTED_TOKEN_EXTENSION");
  const bare = ranked("meteora-dbc", buy(), SHARES_FOR_100, { rawRouteMetadata: null });
  assert.ok(failing(guardQuote(bare, DEFAULT_EXECUTION_POLICY, ctx("meteora-dbc"))).includes("dbc.metadata"));
});

test("DAMM v2: pool status and mint support from metadata", () => {
  const ok = ranked("meteora-damm-v2", buy(), SHARES_FOR_100, { rawRouteMetadata: dammMeta() });
  assert.equal(guardQuote(ok, DEFAULT_EXECUTION_POLICY, ctx("meteora-damm-v2")).approved, true);
  const disabled = ranked("meteora-damm-v2", buy(), SHARES_FOR_100, { rawRouteMetadata: dammMeta({ poolStatus: "Disable" }) });
  assert.equal(guardQuote(disabled, DEFAULT_EXECUTION_POLICY, ctx("meteora-damm-v2")).reason, "POOL_INACTIVE");
  const hooked = ranked("meteora-damm-v2", buy(), SHARES_FOR_100, { rawRouteMetadata: dammMeta({ tokenB: mintInspection(USDC_MINT, 6, false, { supported: false, unsupportedReason: "transfer fee 30 bps" }) }) });
  assert.equal(guardQuote(hooked, DEFAULT_EXECUTION_POLICY, ctx("meteora-damm-v2")).reason, "UNSUPPORTED_TOKEN_EXTENSION");
});

test("an unavailable quote or an out-of-scope pair never passes", () => {
  const unavailable = rankQuote({ ...venueQuote("raydium", buy(), SHARES_FOR_100), unavailableReason: "NO_VERIFIED_POOL" }, buy(), 15);
  assert.equal(guardQuote(unavailable, DEFAULT_EXECUTION_POLICY, ctx("raydium")).reason, "NO_VERIFIED_POOL");
  const other = ranked("raydium", { ...buy(), outputMint: key(70) }, SHARES_FOR_100, { outputMint: key(70) });
  assert.ok(failing(guardQuote(other, DEFAULT_EXECUTION_POLICY, ctx("raydium"))).includes("scope.usdcEquity"));
});

test("guardResult picks the best passing quote in engine order and reports every refusal", () => {
  const best = ranked("meteora-dbc", buy(), (21n * 10n ** BigInt(DEC)).toString(), { poolAddress: key(43), rawRouteMetadata: dbcMeta({ poolAddress: key(43), lifecycleState: "MIGRATING" }) });
  const second = ranked("raydium");
  const third = ranked("jupiter", buy(), (19n * 10n ** BigInt(DEC)).toString());
  const result: EngineResult = { enabled: true, request: buy(), best, alternatives: [second, third], route: null, exclusions: [], quotedAt: new Date(NOW).toISOString(), slot: SLOT, latencyMs: {} };
  const registry = buildPoolRegistry([pool("raydium"), pool("meteora-dbc", { address: key(43), id: "x" })]);
  const g = guardResult(result, DEFAULT_EXECUTION_POLICY, { now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry });
  assert.equal(g.selected?.quote.venue, "raydium");
  assert.deepEqual(g.refused.map((v) => [v.quote.venue, v.reason]), [["meteora-dbc", "ROUTE_MIGRATING"]]);
  assert.equal(g.verdicts.length, 3);
});

test("company-level: sells never cross representations; buys pick the best approved", () => {
  const a = guardQuote(ranked("raydium"), DEFAULT_EXECUTION_POLICY, ctx("raydium"));
  const b = guardQuote(ranked("raydium", buy(), (22n * 10n ** BigInt(DEC)).toString()), DEFAULT_EXECUTION_POLICY, ctx("raydium"));
  const candidates = [
    { representationId: "xstocks:A", verdict: a },
    { representationId: "backpack:A", verdict: b },
  ];
  assert.equal(selectAcrossRepresentations(candidates, "buy", null)?.representationId, "backpack:A");
  assert.equal(selectAcrossRepresentations(candidates, "sell", null), null);
  assert.equal(selectAcrossRepresentations(candidates, "sell", "xstocks:A")?.representationId, "xstocks:A");
  assert.equal(selectAcrossRepresentations(candidates, "sell", "ondo:A"), null);
});

test("aggregator venues (openocean) are guarded without registry/slot checks and stay quote-only", () => {
  const v = guardQuote(ranked("openocean", buy(), SHARES_FOR_100, { poolAddress: null, onchainCheckedAtQuote: false, executionPath: "none", slot: null }), DEFAULT_EXECUTION_POLICY, ctx("jupiter"));
  assert.deepEqual(failing(v), []);
  assert.equal(v.mode, "quote-only");
});
