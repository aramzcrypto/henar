/**
 * DBC Studio, offline. The SDK is the oracle for every config; the monitor
 * runs on the synthetic DBC fixture with injected readers (no RPC).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import { USDC_MINT, listRouterRepresentations, type VerifiedPool } from "@henar/router-core";
import {
  STUDIO_PRESETS,
  buildStudioConfig,
  monitorDbcMarket,
  monitorRegistryDbcMarkets,
  recommendFeeProfile,
  recommendGraduation,
  toSdkInput,
  type StudioMarketConfig,
} from "@henar/dbc-studio";
import { CURRENT_POINT, afterBuy, buildDbcMarket } from "./fixtures/meteora-dbc";
import { buildDammV2Market } from "./fixtures/meteora-damm-v2";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const POOL = key(21);
const CONFIG = key(22);
const DAMM = key(23);

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

const equity: StudioMarketConfig = {
  baseTokenType: "Token2022",
  baseDecimals: 8,
  tokenAuthority: "Immutable",
  totalTokenSupply: 1_000_000,
  leftover: 0,
  initialMarketCap: 50_000_000,
  migrationMarketCap: 100_000_000,
  baseFee: { mode: "exponential", startingFeeBps: 300, endingFeeBps: 100, numberOfPeriod: 6, totalDuration: 1800 },
  dynamicFeeEnabled: true,
  collectFeeMode: "QuoteToken",
  creatorTradingFeePercentage: 0,
  poolCreationFee: 0,
  migrationOption: "MET_DAMM_V2",
  migrationFeeOption: "FixedBps100",
  migrationFeePercentage: 1,
  creatorMigrationFeePercentage: 0,
  liquidityDistribution: { partnerPermanentLockedPercentage: 100, partnerPercentage: 0, creatorPermanentLockedPercentage: 0, creatorPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: "Timestamp",
};

// ---------------------------------------------------------------------------
// DBC-19 configuration
// ---------------------------------------------------------------------------

test("buildStudioConfig: an equity-style config passes SDK validation and matches buildCurveWithMarketCap", () => {
  const result = buildStudioConfig(equity);
  assert.equal(result.ok, true, result.ok ? "" : result.problems.join("; "));
  if (!result.ok) return;
  const direct = dbc.buildCurveWithMarketCap(toSdkInput(equity));
  assert.equal(result.params.migrationQuoteThreshold.toString(), direct.migrationQuoteThreshold.toString());
  assert.equal(result.params.sqrtStartPrice.toString(), direct.sqrtStartPrice.toString());
  assert.equal(result.summary.migrationQuoteThreshold.raw, direct.migrationQuoteThreshold.toString());
  assert.equal(result.summary.quoteMint, USDC_MINT);
  assert.equal(result.summary.totalTokenSupply.display, "1000000");
  assert.equal(result.summary.migratedPoolFee.poolFeeBps, 0); // fixed option: the SDK reports the DAMM v2 config fee elsewhere
  assert.equal(result.summary.baseFeeMode, "FeeSchedulerExponential");
  assert.equal(result.summary.dynamicFeeEnabled, true);
  // Initial and migration prices follow the caps (quote per base, 1M supply).
  assert.ok(Math.abs(Number(result.summary.initialPrice) - 50) < 1e-6, result.summary.initialPrice);
  assert.ok(Math.abs(Number(result.summary.migrationPrice) - 100) < 1e-6, result.summary.migrationPrice);
  // Percentage of supply on migration follows the SDK's adjusted formula: r(1-f)/(1+r(1-f)), r = sqrt(0.5), f = 1%.
  const r = Math.sqrt(0.5) * 0.99;
  assert.ok(Math.abs(Number(result.summary.percentageSupplyOnMigration) - (100 * r) / (1 + r)) < 0.01, result.summary.percentageSupplyOnMigration);
  // Migration quote amount is the threshold net of the migration fee.
  assert.equal(
    result.summary.migrationQuoteAmount.raw,
    dbc.getMigrationQuoteAmountFromMigrationQuoteThreshold(new Decimal(result.summary.migrationQuoteThreshold.raw), 1).floor().toFixed(0),
  );
  // The SDK's own validator accepts the params.
  assert.doesNotThrow(() => dbc.validateConfigParameters({ ...result.params, leftoverReceiver: new PublicKey(DAMM) }));
});

test("buildStudioConfig: presets build and validate", () => {
  for (const [name, preset] of Object.entries(STUDIO_PRESETS)) {
    const result = buildStudioConfig(preset.config);
    assert.equal(result.ok, true, `${name}: ${result.ok ? "" : result.problems.join("; ")}`);
  }
});

test("buildStudioConfig: customizable migrated pool fee is passed through", () => {
  const result = buildStudioConfig({
    ...equity,
    migrationFeeOption: { customizable: { poolFeeBps: 30, collectFeeMode: "QuoteToken", dynamicFee: true } },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.problems.join("; "));
  if (!result.ok) return;
  assert.equal(result.summary.migrationFeeOption, "Customizable");
  assert.deepEqual(result.summary.migratedPoolFee, { poolFeeBps: 30, collectFeeMode: "QuoteToken", dynamicFee: true });
  assert.equal(Number(result.params.migrationFeeOption), dbc.MigrationFeeOption.Customizable);
});

test("buildStudioConfig refuses deprecated modes and migration cap <= initial cap", () => {
  const damm1 = buildStudioConfig({ ...equity, migrationOption: "MET_DAMM" as never });
  assert.equal(damm1.ok, false);
  assert.ok(!damm1.ok && damm1.problems.some((p) => /MET_DAMM is deprecated/.test(p)), JSON.stringify(damm1));

  const limiter = buildStudioConfig({ ...equity, baseFee: { ...equity.baseFee, mode: "rateLimiter" as never } });
  assert.equal(limiter.ok, false);
  assert.ok(!limiter.ok && limiter.problems.some((p) => /RateLimiter is deprecated/.test(p)));

  const equal = buildStudioConfig({ ...equity, migrationMarketCap: equity.initialMarketCap });
  assert.equal(equal.ok, false);
  assert.ok(!equal.ok && equal.problems.some((p) => /migrationMarketCap must be greater than initialMarketCap/.test(p)));

  const lower = buildStudioConfig({ ...equity, migrationMarketCap: equity.initialMarketCap / 2 });
  assert.equal(lower.ok, false);

  const badDecimals = buildStudioConfig({ ...equity, baseDecimals: 5 as never });
  assert.ok(!badDecimals.ok && badDecimals.problems.some((p) => /baseDecimals 5 is not in TokenDecimal/.test(p)));

  const badFee = buildStudioConfig({ ...equity, migrationFeePercentage: dbc.MAX_MIGRATION_FEE_PERCENTAGE + 1 });
  assert.ok(!badFee.ok && badFee.problems.some((p) => /migrationFeePercentage/.test(p)));

  const badLp = buildStudioConfig({ ...equity, liquidityDistribution: { ...equity.liquidityDistribution, partnerPermanentLockedPercentage: 90 } });
  assert.ok(!badLp.ok && badLp.problems.some((p) => /sum to 100/.test(p)));
});

test("buildStudioConfig surfaces the SDK validator's message", () => {
  // Locked liquidity below the SDK's 10% day-1 floor is a rule only the SDK enforces.
  const result = buildStudioConfig({
    ...equity,
    liquidityDistribution: { partnerPermanentLockedPercentage: 0, partnerPercentage: 100, creatorPermanentLockedPercentage: 0, creatorPercentage: 0 },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((p) => /SDK validateConfigParameters: .*locked liquidity/i.test(p)), JSON.stringify(result));
});

// ---------------------------------------------------------------------------
// DBC-20 graduation model
// ---------------------------------------------------------------------------

test("recommendGraduation: T = 10,000, I = 50 bps -> Q = 2,000,000; 1% fee -> threshold 2,020,202.02", () => {
  const rec = recommendGraduation({
    targetTradeSizeQuote: 10_000,
    maxPriceImpactBps: 50,
    referencePriceQuote: 100,
    totalTokenSupply: 1_000_000,
    quoteDecimals: 6,
    baseDecimals: 8,
    migrationFeePercentage: 1,
  });
  assert.equal(rec.ok, true, rec.ok ? "" : rec.problems.join("; "));
  if (!rec.ok) return;
  assert.equal(rec.label, "MODELED / ESTIMATED");
  assert.equal(rec.modeled, true);
  assert.equal(rec.requiredQuoteLiquidity.display, "2000000.000000");
  assert.equal(rec.requiredQuoteLiquidity.raw, "2000000000000");
  assert.equal(rec.recommendedMigrationQuoteThreshold.display, "2020202.020202");
  assert.equal(rec.recommendedMigrationQuoteThreshold.raw, "2020202020202");
  assert.equal(rec.recommendedMigrationMarketCap, "100000000.000000");
  assert.equal(rec.impliedBaseReserve, "20000.00000000");
  assert.equal(rec.impliedPercentageSupplyOnMigration, "2.000000");
  assert.ok(Math.abs(rec.modeledImpactBpsAtTarget - 50) < 1, String(rec.modeledImpactBpsAtTarget));
  // The SDK's actual threshold for the derived caps, reported and compared.
  assert.ok(rec.sdkMigrationQuoteThreshold !== null, rec.caveats.join("; "));
  assert.ok(rec.sdkDivergenceBps !== null && rec.sdkDivergenceBps <= 1, `divergence ${rec.sdkDivergenceBps} bps: ${rec.caveats.join("; ")}`);
  assert.ok(rec.impliedInitialMarketCap !== null);
  // Direct SDK read-back: the same caps must reproduce the threshold.
  const direct = dbc.buildCurveWithMarketCap({
    ...toSdkInput({ ...equity, migrationFeePercentage: 1 }),
    initialMarketCap: Number(rec.impliedInitialMarketCap),
    migrationMarketCap: Number(rec.recommendedMigrationMarketCap),
  });
  assert.equal(direct.migrationQuoteThreshold.toString(), rec.sdkMigrationQuoteThreshold!.raw);
  // Documented model limits are always present.
  assert.ok(rec.assumptions.some((a) => /Q = T \/ I/.test(a)));
  assert.ok(rec.caveats.some((c) => /Concentrated post-migration liquidity is NOT modeled/.test(c)));
  assert.ok(rec.caveats.some((c) => /DAMM v2 trading fees are NOT modeled/.test(c)));
  assert.ok(rec.caveats.some((c) => /not a guaranteed post-graduation slippage/.test(c)));
  // 2% of supply on migration is below the sensible floor and is flagged.
  assert.ok(rec.caveats.some((c) => /< 10%/.test(c)));
});

test("recommendGraduation: zero migration fee leaves threshold == Q and agrees with the SDK", () => {
  const rec = recommendGraduation({
    targetTradeSizeQuote: 50_000,
    maxPriceImpactBps: 100,
    referencePriceQuote: 20,
    totalTokenSupply: 1_000_000,
    quoteDecimals: 6,
    baseDecimals: 8,
    migrationFeePercentage: 0,
  });
  assert.equal(rec.ok, true);
  if (!rec.ok) return;
  assert.equal(rec.requiredQuoteLiquidity.raw, rec.recommendedMigrationQuoteThreshold.raw);
  assert.equal(rec.impliedPercentageSupplyOnMigration, "25.000000"); // 5,000,000 / 20 = 250,000 tokens of 1M
  assert.ok(rec.sdkDivergenceBps !== null && rec.sdkDivergenceBps <= 1, rec.caveats.join("; "));
  assert.ok(!rec.caveats.some((c) => /< 10%|> 80%|≥ 100%/.test(c)), rec.caveats.join("; "));
});

test("recommendGraduation refuses invalid inputs", () => {
  const good = { targetTradeSizeQuote: 10_000, maxPriceImpactBps: 50, referencePriceQuote: 100, totalTokenSupply: 1_000_000, quoteDecimals: 6, baseDecimals: 8, migrationFeePercentage: 1 };
  for (const bad of [
    { ...good, targetTradeSizeQuote: 0 },
    { ...good, targetTradeSizeQuote: -1 },
    { ...good, maxPriceImpactBps: 0 },
    { ...good, maxPriceImpactBps: 10_000 },
    { ...good, referencePriceQuote: Number.NaN },
    { ...good, totalTokenSupply: 0 },
    { ...good, migrationFeePercentage: 100 },
    { ...good, migrationFeePercentage: 1.5 },
  ]) {
    const rec = recommendGraduation(bad);
    assert.equal(rec.ok, false, JSON.stringify(bad));
    assert.ok(!rec.ok && rec.problems.length > 0);
  }
  // Impossible target (supply share ≥ 100%) is answered with a caveat, never a fabricated cap.
  const impossible = recommendGraduation({ ...good, referencePriceQuote: 1, totalTokenSupply: 1_000 });
  assert.equal(impossible.ok, true);
  if (!impossible.ok) return;
  assert.equal(impossible.impliedInitialMarketCap, null);
  assert.equal(impossible.sdkMigrationQuoteThreshold, null);
  assert.ok(impossible.caveats.some((c) => /≥ 100%/.test(c)));
});

// ---------------------------------------------------------------------------
// Fee profile
// ---------------------------------------------------------------------------

test("recommendFeeProfile output validates through the SDK and never uses RateLimiter", () => {
  for (const expectedVolatility of ["low", "medium", "high"] as const)
    for (const liquidity of ["thin", "moderate", "deep"] as const)
      for (const maturity of ["launch", "established"] as const) {
        const rec = recommendFeeProfile({ expectedVolatility, liquidity, maturity });
        assert.equal(rec.ok, true, rec.ok ? "" : rec.problems.join("; "));
        if (!rec.ok) continue;
        assert.equal(rec.label, "MODELED");
        assert.notEqual(rec.baseFeeParams.baseFeeMode, dbc.BaseFeeMode.RateLimiter);
        assert.ok(rec.endingFeeBps >= dbc.MIN_FEE_BPS && rec.startingFeeBps <= dbc.MAX_FEE_BPS);
        const sdk = dbc.getFeeSchedulerParams(rec.startingFeeBps, rec.endingFeeBps, rec.baseFeeParams.baseFeeMode, rec.numberOfPeriod, rec.totalDuration);
        assert.equal(sdk.cliffFeeNumerator.toString(), rec.sdkBaseFee.cliffFeeNumerator.toString());
        assert.equal(sdk.baseFeeMode, rec.sdkBaseFee.baseFeeMode);
        if (maturity === "established") assert.equal(rec.startingFeeBps, rec.endingFeeBps);
        else assert.ok(rec.startingFeeBps > rec.endingFeeBps);
        assert.equal(rec.dynamicFeeEnabled, expectedVolatility !== "low");
        for (const line of Object.values(rec.rationale)) assert.ok(line.length > 0);
      }
  const bad = recommendFeeProfile({ expectedVolatility: "extreme" as never, liquidity: "thin", maturity: "launch" });
  assert.equal(bad.ok, false);
});

// ---------------------------------------------------------------------------
// DBC-18 monitor (offline fixture, injected readers)
// ---------------------------------------------------------------------------

test("monitorDbcMarket on a bonding fixture reports lifecycle, progress and price", async () => {
  const market = afterBuy(buildDbcMarket(base), 1_000_000_000n); // 1,000 USDC in
  const view = await monitorDbcMarket(null, POOL, {
    readMarket: async () => market,
    resolveSuccessor: async () => {
      throw new Error("must not be called while bonding");
    },
    registryPool: registryPool(),
  });
  assert.deepEqual(view.errors, []);
  assert.equal(view.lifecycle, "BONDING");
  assert.equal(view.tradable, true);
  assert.equal(view.poolAddress, POOL);
  assert.equal(view.configAddress, CONFIG);
  assert.equal(view.representationId, rep.id);
  assert.equal(view.tokenSymbol, rep.tokenSymbol);
  assert.equal(view.baseMint, rep.mint);
  assert.equal(view.quoteMint, USDC_MINT);
  assert.equal(view.verification, "DISCOVERED");
  assert.equal(view.eligibility, "ROUTER_ELIGIBLE");
  assert.ok(view.graduationProgressBps !== null && view.graduationProgressBps > 0 && view.graduationProgressBps < 10_000);
  assert.equal(view.quoteReserve, market.pool.poolState.quoteReserve.toString());
  assert.equal(view.migrationQuoteThreshold, market.config.migrationQuoteThreshold.toString());
  assert.ok(view.currentPrice !== null && Number(view.currentPrice) > 0, String(view.currentPrice));
  assert.equal(view.currentPrice, dbc.getPriceFromSqrtPrice(market.pool.poolState.sqrtPrice, 8, 6).toFixed(12));
  assert.equal(view.baseFeeMode, "FeeSchedulerLinear");
  assert.equal(view.dynamicFeeEnabled, true);
  assert.equal(view.collectFeeMode, "QuoteToken");
  assert.equal(view.activationType, "Timestamp");
  assert.equal(view.currentPoint, CURRENT_POINT.toString());
  assert.equal(view.migrationOption, "MET_DAMM_V2");
  assert.equal(view.migrationFeeOption, dbc.MigrationFeeOption.FixedBps100);
  assert.ok(typeof view.currentFeeBps === "number" && view.currentFeeBps >= 100);
  assert.equal(view.successorStatus, "NOT_APPLICABLE");
  assert.equal(view.successor, null);
  assert.equal(view.slot, market.slot);
  assert.equal(view.readAt, market.readAt);
});

test("monitorDbcMarket on a graduated fixture reads the confirmed DAMM v2 successor", async () => {
  const graduated = buildDbcMarket(base, { isMigrated: 1, migrationProgress: 3 });
  const successor = buildDammV2Market({ poolAddress: DAMM, tokenAMint: rep.mint, price: "7" });
  const view = await monitorDbcMarket(null, POOL, {
    readMarket: async () => graduated,
    resolveSuccessor: async () => ({ status: "CONFIRMED", poolAddress: DAMM, detail: "ok" }),
    readSuccessor: async (address) => (address === DAMM ? successor : null),
    registryPool: registryPool(),
  });
  assert.deepEqual(view.errors, []);
  assert.equal(view.lifecycle, "GRADUATED");
  assert.equal(view.tradable, false);
  assert.equal(view.successorStatus, "CONFIRMED");
  assert.equal(view.successorPoolAddress, DAMM);
  assert.ok(view.successor);
  assert.equal(view.successor!.poolAddress, DAMM);
  assert.equal(view.successor!.status, "Enable");
  assert.equal(view.successor!.sqrtPrice, successor.pool.sqrtPrice.toString());
  assert.deepEqual(new Set([view.successor!.tokenAMint, view.successor!.tokenBMint]), new Set([rep.mint, USDC_MINT]));

  // A successor the reader cannot find is an error, not a fabricated view.
  const missing = await monitorDbcMarket(null, POOL, {
    readMarket: async () => graduated,
    resolveSuccessor: async () => ({ status: "CONFIRMED", poolAddress: DAMM, detail: "ok" }),
    readSuccessor: async () => null,
    registryPool: registryPool(),
  });
  assert.equal(missing.successor, null);
  assert.ok(missing.errors.some((e) => /successor pool .* not found/.test(e)));
});

test("monitorDbcMarket: a failing reader yields errors and UNKNOWN, never a throw", async () => {
  const view = await monitorDbcMarket(null, POOL, {
    readMarket: async () => {
      throw new Error("rpc timeout");
    },
    registryPool: registryPool(),
  });
  assert.equal(view.lifecycle, "UNKNOWN");
  assert.equal(view.tradable, false);
  assert.ok(view.errors.some((e) => /rpc timeout/.test(e)));
  assert.equal(view.currentPrice, null);
  assert.equal(view.graduationProgressBps, null);
  assert.equal(view.quoteReserve, null);
  // Registry facts are still reported; chain facts are not.
  assert.equal(view.representationId, rep.id);
  assert.equal(view.configAddress, CONFIG);

  const absent = await monitorDbcMarket(null, POOL, { readMarket: async () => null, registryPool: registryPool() });
  assert.equal(absent.lifecycle, "UNKNOWN");
  assert.ok(absent.errors.some((e) => /not found on chain/.test(e)));

  const noReader = await monitorDbcMarket(null, POOL, { registryPool: null });
  assert.equal(noReader.lifecycle, "UNKNOWN");
  assert.ok(noReader.errors.some((e) => /no RPC connection/.test(e)));
  assert.equal(noReader.representationId, null);
  assert.equal(noReader.verification, null);
});

test("monitorRegistryDbcMarkets maps every DBC record and isolates failures", async () => {
  const other = key(24);
  const pools = [registryPool(), registryPool({ id: `meteora-dbc:${other}`, address: other, enabled: false, eligibility: "STOCK_PAIRED_INFRASTRUCTURE" })];
  const views = await monitorRegistryDbcMarkets(null, {
    pools,
    deps: {
      readMarket: async (address) => {
        if (address === POOL) return buildDbcMarket(base);
        throw new Error(`boom ${address}`);
      },
    },
  });
  assert.equal(views.length, 2);
  assert.equal(views[0].poolAddress, POOL);
  assert.equal(views[0].lifecycle, "BONDING");
  assert.deepEqual(views[0].errors, []);
  assert.equal(views[1].poolAddress, other);
  assert.equal(views[1].lifecycle, "UNKNOWN");
  assert.equal(views[1].eligibility, "STOCK_PAIRED_INFRASTRUCTURE");
  assert.ok(views[1].errors.some((e) => /boom/.test(e)));
});
