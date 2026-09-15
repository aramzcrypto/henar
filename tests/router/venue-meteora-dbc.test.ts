/**
 * Meteora DBC adapter, offline. The SDK's own `swapQuoteExactIn` is the
 * oracle: every normalized amount must equal the SDK's output exactly
 * (integer, zero tolerance) on the same synthetic state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  USDC_MINT,
  listRouterRepresentations,
  quoteRepresentation,
  type QuoteContext,
  type QuoteRequest,
  type VerifiedPool,
  type DbcQuoteMetadata,
} from "@henar/router-core";
import {
  MeteoraDbcAdapter,
  classifyDbcLifecycle,
  dbcFacts,
  quoteDbcExactIn,
  refreshDbcLifecycle,
  confirmDammV2Pool,
  type DbcMarketState,
} from "@henar/venue-meteora-dbc";
import { CURRENT_POINT, afterBuy, buildDbcMarket } from "./fixtures/meteora-dbc";
import { PublicKey } from "@solana/web3.js";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const POOL = key(11);
const CONFIG = key(12);
const LAUNCH = key(13);
const OTHER_CONFIG = key(14);
const DAMM = key(15);

function registryPool(overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  return {
    id: `meteora-dbc:${POOL}`,
    representationId: rep.id,
    mint: rep.mint,
    provider: rep.provider,
    tokenSymbol: rep.tokenSymbol,
    venue: "meteora-dbc",
    address: POOL,
    programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    poolType: "dbc",
    baseMint: rep.mint,
    quoteMint: USDC_MINT,
    feeBps: 100,
    feeConfig: { configId: CONFIG },
    observedTokenPrograms: null,
    tvlUsd: null,
    discoveredFrom: "test",
    discoveredAt: "2026-09-15T00:00:00.000Z",
    verifiedAt: "2026-09-15T00:00:00.000Z",
    verification: "DISCOVERED",
    onchainVerifiedAt: null,
    verificationDetail: null,
    eligibility: "ROUTER_ELIGIBLE",
    dbc: {
      configAddress: CONFIG,
      lifecycle: "BONDING",
      lifecycleCheckedAt: null,
      lifecycleSlot: null,
      successorStatus: "NOT_APPLICABLE",
      successorPoolAddress: null,
      successorConfirmedAt: null,
    },
    enabled: true,
    disabledReason: null,
    ...overrides,
  };
}

const base = { poolAddress: POOL, configAddress: CONFIG, baseMint: rep.mint };
const NOW = Date.now();

function ctx(pools: VerifiedPool[], now = NOW): QuoteContext {
  return { connection: null, pools, now, deadlineMs: 5000 };
}

function buy(amount: string): QuoteRequest {
  return { representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint };
}

function sell(amount: string): QuoteRequest {
  return { representationId: rep.id, side: "sell", amount, amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT };
}

function adapterFor(market: DbcMarketState | null | (() => Promise<DbcMarketState | null>), extra = {}) {
  return new MeteoraDbcAdapter({
    quotesEnabled: true,
    readMarket: async () => (typeof market === "function" ? market() : market),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Quotes match the SDK exactly
// ---------------------------------------------------------------------------

for (const [label, amount] of [
  ["small", "1000000"], // 1 USDC
  ["medium", "100000000"], // 100 USDC
  ["large", "10000000000"], // 10,000 USDC
] as const) {
  test(`buy quote (${label}) equals the SDK's swapQuoteExactIn, integer-exact`, async () => {
    const market = buildDbcMarket(base);
    const adapter = adapterFor(market);
    const quote = await adapter.getQuote(buy(amount), ctx([registryPool()]));
    assert.equal(quote.unavailableReason, null, quote.unavailableDetail ?? "");
    const sdk = dbc.swapQuoteExactIn(market.pool, market.config, false, new BN(amount), 0, false, new BN(CURRENT_POINT.toString()), false);
    assert.equal(quote.expectedAmountOut, sdk.outputAmount.toString());
    assert.equal(quote.amountIn, amount);
    assert.equal(quote.venueFeeAmount, sdk.tradingFee.add(sdk.protocolFee).add(sdk.referralFee).toString());
    assert.equal(quote.onchainCheckedAtQuote, true);
    assert.equal(quote.executionPath, "none");
    const meta = quote.rawRouteMetadata as DbcQuoteMetadata;
    assert.equal(meta.kind, "meteora-dbc");
    assert.equal(meta.lifecycleState, "BONDING");
    assert.equal(meta.nextSqrtPrice, sdk.nextSqrtPrice.toString());
    assert.equal(meta.migrationQuoteThreshold, market.config.migrationQuoteThreshold.toString());
    assert.equal(meta.expectedMigrationVenue, "meteora-damm-v2");
    assert.ok(typeof quote.priceImpactBps === "number" && quote.priceImpactBps >= 0);
  });
}

test("price impact grows with order size", async () => {
  const market = buildDbcMarket(base);
  const adapter = adapterFor(market);
  const small = await adapter.getQuote(buy("1000000"), ctx([registryPool()]));
  const large = await adapter.getQuote(buy("10000000000"), ctx([registryPool()]));
  assert.ok(large.priceImpactBps! > small.priceImpactBps!, `${large.priceImpactBps} > ${small.priceImpactBps}`);
});

test("sell quote equals the SDK after the pool has moved up the curve", async () => {
  const market = afterBuy(buildDbcMarket(base), 100_000_000n);
  const adapter = adapterFor(market);
  const baseHeld = market.pool.poolState.baseReserve; // irrelevant; sell a fixed amount
  void baseHeld;
  const amount = "500000000"; // 5 base units at 8 decimals
  const quote = await adapter.getQuote(sell(amount), ctx([registryPool()]));
  assert.equal(quote.unavailableReason, null, quote.unavailableDetail ?? "");
  const sdk = dbc.swapQuoteExactIn(market.pool, market.config, true, new BN(amount), 0, false, new BN(CURRENT_POINT.toString()), false);
  assert.equal(quote.expectedAmountOut, sdk.outputAmount.toString());
  assert.equal(quote.venueFeeAmount, sdk.tradingFee.add(sdk.protocolFee).toString());
});

test("an order larger than the curve is INSUFFICIENT_LIQUIDITY, never a partial fill", async () => {
  const adapter = adapterFor(buildDbcMarket(base));
  const quote = await adapter.getQuote(buy("100000000000000"), ctx([registryPool()]));
  assert.equal(quote.unavailableReason, "INSUFFICIENT_LIQUIDITY");
});

test("eligible DBC quote flows through the engine with the Henar fee applied once", async () => {
  const market = buildDbcMarket(base);
  const adapter = adapterFor(market);
  const result = await quoteRepresentation(buy("100000000"), {
    adapters: [adapter],
    enabled: true,
    // The engine reads the committed registry; inject our pool via a wrapper adapter.
  });
  // The committed registry has no DBC pool for this representation, so the
  // engine hands the adapter nothing → NO_VERIFIED_POOL. That is the correct
  // production behaviour; the direct-context test above covers the quote.
  assert.equal(result.best, null);
  assert.equal(result.exclusions[0]?.reason, "NO_VERIFIED_POOL");
  // Now the same request against the adapter with the pool present: the
  // engine's fee arithmetic is exercised via rankQuote in engine tests; here
  // we assert the venue is asked for amount − 15 bps by the engine contract.
  const venueSeen: string[] = [];
  const spy = new MeteoraDbcAdapter({
    quotesEnabled: true,
    readMarket: async () => market,
  });
  const original = spy.getQuote.bind(spy);
  spy.getQuote = async (request, c) => {
    venueSeen.push(request.amount);
    return original(request, { ...c, pools: [registryPool()] });
  };
  const ranked = await quoteRepresentation(buy("100000000"), { adapters: [spy], enabled: true });
  assert.deepEqual(venueSeen, ["99850000"]);
  assert.equal(ranked.best?.venue, "meteora-dbc");
  assert.equal(ranked.best?.fees.henarInputFee, "150000");
  assert.equal(ranked.best?.fees.venueInput, "99850000");
  const sdk = dbc.swapQuoteExactIn(market.pool, market.config, false, new BN("99850000"), 0, false, new BN(CURRENT_POINT.toString()), false);
  assert.equal(ranked.best?.fees.grossVenueOutput, sdk.outputAmount.toString());
  assert.equal(ranked.best?.fees.henarOutputFee, "0");
});

// ---------------------------------------------------------------------------
// Fail-closed checks
// ---------------------------------------------------------------------------

test("flag off → VENUE_DISABLED before anything is read", async () => {
  let reads = 0;
  const adapter = new MeteoraDbcAdapter({ quotesEnabled: false, readMarket: async () => { reads += 1; return null; } });
  const quote = await adapter.getQuote(buy("1000000"), ctx([registryPool()]));
  assert.equal(quote.unavailableReason, "VENUE_DISABLED");
  assert.equal(reads, 0);
});

test("no pool / infrastructure-only pool / unknown pool on chain", async () => {
  const none = await adapterFor(buildDbcMarket(base)).getQuote(buy("1"), ctx([]));
  assert.equal(none.unavailableReason, "NO_VERIFIED_POOL");

  // Stock-paired DBC: launch token priced in the stock, never a USDC route.
  const infra = registryPool({
    baseMint: LAUNCH,
    quoteMint: rep.mint,
    eligibility: "STOCK_PAIRED_INFRASTRUCTURE",
    enabled: false,
    disabledReason: "STOCK_PAIRED_INFRASTRUCTURE: not a USDC↔equity route",
  });
  const q = await adapterFor(buildDbcMarket(base)).getQuote(buy("1"), ctx([infra]));
  assert.equal(q.unavailableReason, "NOT_ROUTER_ELIGIBLE");
  assert.equal(q.poolAddress, POOL);

  const missing = await adapterFor(null).getQuote(buy("1"), ctx([registryPool()]));
  assert.equal(missing.unavailableReason, "NO_VERIFIED_POOL");
  assert.match(missing.unavailableDetail ?? "", /not found on chain/);
});

test("wrong mints or config on chain → QUOTE_TERMS_MISMATCH", async () => {
  const wrongBase = buildDbcMarket({ ...base, baseMint: LAUNCH });
  assert.equal((await adapterFor(wrongBase).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const wrongConfig = buildDbcMarket({ ...base, configAddress: OTHER_CONFIG });
  assert.equal((await adapterFor(wrongConfig).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const wrongRequest = await adapterFor(buildDbcMarket(base)).getQuote({ ...buy("1"), inputMint: LAUNCH }, ctx([registryPool()]));
  assert.equal(wrongRequest.unavailableReason, "QUOTE_TERMS_MISMATCH");
});

test("stale state → STALE_STATE", async () => {
  const old = buildDbcMarket({ ...base, readAt: new Date(NOW - 60_000).toISOString() });
  const q = await adapterFor(old).getQuote(buy("1000000"), ctx([registryPool()]));
  assert.equal(q.unavailableReason, "STALE_STATE");
});

test("unsupported Token-2022 extension on either mint fails closed", async () => {
  const hooked = buildDbcMarket(base, {}, { base: { supported: false, unsupportedReason: "transfer hook Hook1111", transferHookProgram: "Hook1111" } });
  const q = await adapterFor(hooked).getQuote(buy("1000000"), ctx([registryPool()]));
  assert.equal(q.unavailableReason, "UNSUPPORTED_TOKEN_EXTENSION");
  assert.match(q.unavailableDetail ?? "", /transfer hook/);
  const feeQuote = buildDbcMarket(base, {}, { quote: { supported: false, unsupportedReason: "transfer fee 50 bps", transferFeeBps: 50 } });
  assert.equal((await adapterFor(feeQuote).getQuote(buy("1000000"), ctx([registryPool()]))).unavailableReason, "UNSUPPORTED_TOKEN_EXTENSION");
});

test("Token-2022 base with only supported extensions quotes normally; raw amounts are never UI-scaled", async () => {
  const scaled = buildDbcMarket(base, {}, { base: { extensions: ["ScaledUiAmountConfig"], scaledUiMultiplier: "2" } });
  const q = await adapterFor(scaled).getQuote(buy("1000000"), ctx([registryPool()]));
  assert.equal(q.unavailableReason, null);
  const sdk = dbc.swapQuoteExactIn(scaled.pool, scaled.config, false, new BN("1000000"), 0, false, new BN(CURRENT_POINT.toString()), false);
  assert.equal(q.expectedAmountOut, sdk.outputAmount.toString()); // raw, not ×2
  assert.equal((q.rawRouteMetadata as DbcQuoteMetadata).baseMint?.scaledUiMultiplier, "2");
});

test("config token_type disagreeing with the mint program is a mismatch", async () => {
  const market = buildDbcMarket(base, {}, { base: { isToken2022: false } });
  assert.equal((await adapterFor(market).getQuote(buy("1000000"), ctx([registryPool()]))).unavailableReason, "QUOTE_TERMS_MISMATCH");
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("lifecycle classification follows program state, not reserve proximity", () => {
  const m = buildDbcMarket(base);
  const f = dbcFacts(m.pool, m.config);
  assert.equal(classifyDbcLifecycle(f, CURRENT_POINT).state, "BONDING");
  // 99.9% of threshold is still BONDING.
  const near = { ...f, quoteReserve: (f.migrationQuoteThreshold * 999n) / 1000n };
  assert.equal(classifyDbcLifecycle(near, CURRENT_POINT).state, "BONDING");
  // Exactly at threshold: curve complete → MIGRATING.
  assert.equal(classifyDbcLifecycle({ ...f, quoteReserve: f.migrationQuoteThreshold }, CURRENT_POINT).state, "MIGRATING");
  assert.equal(classifyDbcLifecycle({ ...f, migrationProgress: 1 }, CURRENT_POINT).state, "MIGRATING");
  assert.equal(classifyDbcLifecycle({ ...f, migrationProgress: 2 }, CURRENT_POINT).state, "MIGRATING");
  assert.equal(classifyDbcLifecycle({ ...f, migrationProgress: 3 }, CURRENT_POINT).state, "GRADUATED");
  assert.equal(classifyDbcLifecycle({ ...f, isMigrated: 1 }, CURRENT_POINT).state, "GRADUATED");
  assert.equal(classifyDbcLifecycle({ ...f, activationPoint: CURRENT_POINT + 1n }, CURRENT_POINT).state, "PAUSED");
  assert.equal(classifyDbcLifecycle({ ...f, migrationProgress: 9 }, CURRENT_POINT).state, "UNKNOWN");
});

test("migration boundary: at the threshold the SDK refuses and the adapter reports ROUTE_MIGRATING", async () => {
  const m = buildDbcMarket(base);
  const boundary = buildDbcMarket(base, { quoteReserve: m.config.migrationQuoteThreshold });
  const q = await adapterFor(boundary).getQuote(buy("1000000"), ctx([registryPool()]));
  assert.equal(q.unavailableReason, "ROUTE_MIGRATING");
  assert.equal((q.rawRouteMetadata as DbcQuoteMetadata).graduationProgressBps, 10_000);
  assert.throws(() => dbc.swapQuoteExactIn(boundary.pool, boundary.config, false, new BN(1), 0, false, new BN(CURRENT_POINT.toString()), false), /completed/);
});

test("migrating (post-bonding / locked vesting) → ROUTE_MIGRATING; graduated → POOL_GRADUATED; not yet active → POOL_INACTIVE", async () => {
  const migrating = buildDbcMarket(base, { migrationProgress: 1 });
  assert.equal((await adapterFor(migrating).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "ROUTE_MIGRATING");
  const graduated = buildDbcMarket(base, { isMigrated: 1, migrationProgress: 3 });
  const g = await adapterFor(graduated).getQuote(buy("1"), ctx([registryPool()]));
  assert.equal(g.unavailableReason, "POOL_GRADUATED");
  assert.equal((g.rawRouteMetadata as DbcQuoteMetadata).lifecycleState, "GRADUATED");
  const paused = buildDbcMarket({ ...base, activationPoint: CURRENT_POINT + 100n });
  assert.equal((await adapterFor(paused).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "POOL_INACTIVE");
});

test("refreshDbcLifecycle links a confirmed DAMM v2 successor and keeps the DBC identity", async () => {
  const graduated = buildDbcMarket(base, { isMigrated: 1, migrationProgress: 3 });
  const snap = await refreshDbcLifecycle(null as never, POOL, {
    readMarket: async () => graduated,
    resolveSuccessor: async () => ({ status: "CONFIRMED", poolAddress: DAMM, detail: "ok" }),
  });
  assert.equal(snap?.lifecycle, "GRADUATED");
  assert.equal(snap?.successorStatus, "CONFIRMED");
  assert.equal(snap?.successorPoolAddress, DAMM);
  assert.equal(snap?.poolAddress, POOL);
  assert.equal(snap?.configAddress, CONFIG);

  const bonding = await refreshDbcLifecycle(null as never, POOL, {
    readMarket: async () => buildDbcMarket(base),
    resolveSuccessor: async () => {
      throw new Error("must not be called while bonding");
    },
  });
  assert.equal(bonding?.lifecycle, "BONDING");
  assert.equal(bonding?.successorStatus, "NOT_APPLICABLE");
  assert.equal(bonding?.tradable, true);
});

test("successor confirmation requires the DAMM v2 owner and the exact mint pair", async () => {
  const cp = await import("@meteora-ag/cp-amm-sdk");
  const offsets = { tokenA: cp.POOL_TOKEN_A_MINT_OFFSET, tokenB: cp.POOL_TOKEN_B_MINT_OFFSET };
  const data = Buffer.alloc(offsets.tokenB + 64);
  new PublicKey(rep.mint).toBuffer().copy(data, offsets.tokenA);
  new PublicKey(USDC_MINT).toBuffer().copy(data, offsets.tokenB);
  const owner = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
  const good = { owner, data, executable: false, lamports: 1, rentEpoch: 0 };
  assert.equal(confirmDammV2Pool(good, rep.mint, USDC_MINT, offsets).ok, true);
  assert.equal(confirmDammV2Pool(good, USDC_MINT, rep.mint, offsets).ok, true); // order-insensitive
  assert.equal(confirmDammV2Pool(null, rep.mint, USDC_MINT, offsets).ok, false);
  assert.equal(confirmDammV2Pool({ ...good, owner: PublicKey.default }, rep.mint, USDC_MINT, offsets).ok, false);
  assert.equal(confirmDammV2Pool(good, LAUNCH, USDC_MINT, offsets).ok, false);
});

test("pure quote wrapper reports fee side and impact consistently", () => {
  const m = buildDbcMarket(base);
  const q = quoteDbcExactIn({ pool: m.pool, config: m.config, swapBaseForQuote: false, amountIn: 100_000_000n, currentPoint: CURRENT_POINT }, dbc.swapQuoteExactIn);
  assert.equal(q.feeOnInput, true); // QuoteToken collect mode, quote in
  assert.equal(q.amountLeft, 0n);
  assert.ok(q.priceImpactBps >= 0 && q.priceImpactBps < 10_000);
});
