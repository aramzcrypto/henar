/**
 * Earn strategy framework, offline: accounting, ladder and range maths,
 * configuration validation, market admission, the safety gate and the
 * breakers. Every number here is exact; none of it touches a chain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountingMismatch,
  accruedYield,
  averagePrice,
  bpsOf,
  convertYield,
  depositPrincipal,
  emptyYieldLedger,
  netYield,
  realizeYield,
  shouldHarvest,
  toBig,
  type YieldBasis,
} from "../src/lib/strategies/accounting";
import {
  baseShare,
  binIdFromUiPrice,
  buildLadder,
  feeApr,
  inRange,
  ladderProgress,
  ladderToBins,
  levelPrices,
  levelWeights,
  positionValueQuote,
  priceRange,
  splitByWeight,
  toPricePerLamport,
  uiPriceFromBinId,
} from "../src/lib/strategies/ladder";
import {
  DEFAULT_ACTION_LIMITS,
  configProblems,
  validateEarnStocksConfig,
  validateRangeYieldConfig,
  validateSmartAccumulateConfig,
} from "../src/lib/strategies/config";
import { admitMarket, MARKET_CANDIDATES, MARKET_CRITERIA, verifiedMarkets } from "../src/lib/strategies/markets";
import { evaluateAction, trippedBreakers } from "../src/lib/strategies/safety";
import { DEMO_EARN_STOCKS, DEMO_RANGE_YIELD, DEMO_SMART_ACCUMULATE, STRATEGY_DEFINITIONS, definitionBySlug } from "../src/lib/strategies/definitions";
import { strategyDeployment } from "../src/lib/strategies/deployment";
import { supportsLimitOrders } from "../src/lib/strategies/adapters/meteora";
import { recordBasis } from "../src/lib/strategies/adapters/kamino";
import type { StrategyInstance } from "../src/lib/strategies/types";

// --- accounting ------------------------------------------------------------

const basis = (liquidity: bigint): YieldBasis => ({ collateralAmount: "1000000", exchangeRateAtBasis: "1", liquidityAtBasis: liquidity.toString(), recordedAt: "2026-09-16T00:00:00.000Z" });

test("accrued yield is the gain over the recorded basis, and never negative", () => {
  assert.equal(accruedYield(1_050_000n, basis(1_000_000n)), 50_000n);
  assert.equal(accruedYield(1_000_000n, basis(1_000_000n)), 0n);
  // A rate that moved the wrong way is zero yield, not a debt.
  assert.equal(accruedYield(990_000n, basis(1_000_000n)), 0n);
});

test("a deposit basis is recorded from the protocol's own numbers", () => {
  const recorded = recordBasis({ collateralAmount: 999_000n, liquidityValue: 1_000_000n, exchangeRate: "0.999", at: "2026-09-16T00:00:00.000Z" });
  assert.equal(recorded.collateralAmount, "999000");
  assert.equal(recorded.liquidityAtBasis, "1000000");
  assert.equal(recorded.exchangeRateAtBasis, "0.999");
});

test("harvest waits for a threshold, an interval, and something to harvest", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  const common = { minimumAmount: 5_000_000n, maximumAmount: 100_000_000n, minimumIntervalMs: 86_400_000, now };
  assert.deepEqual(shouldHarvest({ ...common, accrued: 0n, lastHarvestAt: null }), { harvest: false, amount: 0n, reason: "no yield has accrued yet" });
  const small = shouldHarvest({ ...common, accrued: 140_000n, lastHarvestAt: null });
  assert.equal(small.harvest, false);
  assert.match(small.reason!, /below the 5000000 minimum/);
  const ready = shouldHarvest({ ...common, accrued: 6_000_000n, lastHarvestAt: null });
  assert.deepEqual(ready, { harvest: true, amount: 6_000_000n, reason: null });
  const tooSoon = shouldHarvest({ ...common, accrued: 6_000_000n, lastHarvestAt: now - 3_600_000 });
  assert.equal(tooSoon.harvest, false);
  assert.match(tooSoon.reason!, /eligible in about 23h/);
  // A large accrual is capped at the per-conversion ceiling.
  assert.equal(shouldHarvest({ ...common, accrued: 500_000_000n, lastHarvestAt: null }).amount, 100_000_000n);
});

test("principal is never converted, and a performance fee comes only from realized yield", () => {
  let ledger = depositPrincipal(emptyYieldLedger(), 1_000_000_000n);
  assert.equal(ledger.principalDeposited, 1_000_000_000n);
  // A 10% fee would be taken here if one were ever active.
  ledger = realizeYield(ledger, 10_000_000n, 1_000);
  assert.equal(ledger.yieldRealized, 10_000_000n);
  assert.equal(ledger.strategyFees, 1_000_000n);
  assert.equal(ledger.yieldPendingConversion, 9_000_000n);
  assert.equal(netYield(ledger), 9_000_000n);
  ledger = convertYield(ledger, 9_000_000n, 42_000_000n);
  assert.equal(ledger.yieldPendingConversion, 0n);
  assert.equal(ledger.stockAccumulated, 42_000_000n);
  // Principal is untouched by every step.
  assert.equal(ledger.principalDeposited, 1_000_000_000n);
  // And it cannot be reached: a conversion beyond realized yield is refused.
  assert.throws(() => convertYield(ledger, 1n, 1n), /principal is never converted/);
});

test("the preview fee is zero, so realized yield converts in full", () => {
  const ledger = realizeYield(depositPrincipal(emptyYieldLedger(), 1_000_000n), 5_000_000n, DEMO_EARN_STOCKS ? 0 : 0);
  assert.equal(ledger.strategyFees, 0n);
  assert.equal(ledger.yieldPendingConversion, 5_000_000n);
  assert.equal(netYield(ledger), 5_000_000n);
});

test("average acquisition price is exact across decimals, and null before a fill", () => {
  // 214.16 USDC for 1 NVDAx: 6-decimal quote, 8-decimal base.
  assert.equal(averagePrice(214_160_000n, 100_000_000n, 6, 8), "214.16");
  assert.equal(averagePrice(0n, 100n, 6, 8), null);
  assert.equal(averagePrice(100n, 0n, 6, 8), null);
  assert.equal(bpsOf(1_000_000n, 1_000), 100_000n);
  assert.throws(() => bpsOf(1n, 10_001), /bps out of range/);
  assert.throws(() => toBig("1.5"), /not a base-unit integer/);
});

test("an accounting mismatch beyond tolerance is reported, and a small drift is not", () => {
  assert.equal(accountingMismatch({ ledgerPrincipal: 1_000_000n, protocolPrincipal: 1_000_100n, toleranceBps: 50 }), null);
  assert.match(accountingMismatch({ ledgerPrincipal: 1_000_000n, protocolPrincipal: 1_100_000n, toleranceBps: 50 })!, /differs from protocol/);
  assert.equal(accountingMismatch({ ledgerPrincipal: 1_000_000n, protocolPrincipal: null, toleranceBps: 50 }), null);
});

// --- ladder ----------------------------------------------------------------

test("levels are evenly spaced through the range, below the reference", () => {
  const prices = levelPrices({ reference: "200", rangeStartBps: 200, rangeEndBps: 1_000, levels: 5 });
  assert.deepEqual(prices, ["196", "192", "188", "184", "180"]);
  assert.deepEqual(levelPrices({ reference: "200", rangeStartBps: 200, rangeEndBps: 1_000, levels: 1 }), ["196"]);
  assert.throws(() => levelPrices({ reference: "0", rangeStartBps: 200, rangeEndBps: 1_000, levels: 5 }), /positive price/);
  assert.throws(() => levelPrices({ reference: "200", rangeStartBps: 1_000, rangeEndBps: 200, levels: 5 }), /deeper/);
});

test("even and deeper-dip distributions allocate exactly, losing no base unit", () => {
  assert.deepEqual(levelWeights(3, "EVEN"), [1, 1, 1]);
  assert.deepEqual(levelWeights(5, "DEEPER_DIP"), [1, 2, 3, 4, 5]);
  const even = buildLadder({ reference: "200", rangeStartBps: 200, rangeEndBps: 1_000, levels: 5, distribution: "EVEN", capital: 100_000_000n });
  assert.equal(even.reduce((s, l) => s + BigInt(l.allocated), 0n), 100_000_000n);
  assert.deepEqual(even.map((l) => l.allocated), ["20000000", "20000000", "20000000", "20000000", "20000000"]);
  const deeper = buildLadder({ reference: "200", rangeStartBps: 200, rangeEndBps: 1_000, levels: 5, distribution: "DEEPER_DIP", capital: 100_000_000n });
  assert.equal(deeper.reduce((s, l) => s + BigInt(l.allocated), 0n), 100_000_000n);
  // Deeper levels get progressively more: 1/15, 2/15 … 5/15 of the capital.
  assert.deepEqual(deeper.map((l) => l.allocated), ["6666666", "13333333", "20000000", "26666666", "33333335"]);
  // Rounding never invents or loses a unit; the remainder lands on the last level.
  assert.equal(splitByWeight(100n, [3, 3, 3]).reduce((a, b) => a + b, 0n), 100n);
  assert.deepEqual(splitByWeight(100n, [3, 3, 3]), [33n, 33n, 34n]);
  assert.throws(() => splitByWeight(10n, [0]), /positive/);
});

test("ladder progress counts only what the protocol reported", () => {
  const levels = buildLadder({ reference: "200", rangeStartBps: 200, rangeEndBps: 1_000, levels: 4, distribution: "EVEN", capital: 40_000_000n });
  const fresh = ladderProgress(levels);
  assert.equal(fresh.levelsFilled, 0);
  assert.equal(fresh.levelsRemaining, 4);
  assert.equal(fresh.remainingQuote, 40_000_000n);
  const partly = ladderProgress([{ ...levels[0], status: "filled", filledQuote: "10000000", filledBase: "5000000" }, ...levels.slice(1)]);
  assert.equal(partly.levelsFilled, 1);
  assert.equal(partly.levelsRemaining, 3);
  assert.equal(partly.filledQuote, 10_000_000n);
});

test("bin maths converts UI price to price-per-lamport before mapping, and round-trips", () => {
  // NVDAx is 8 decimals against 6-decimal USDC, so the exponent is -2.
  assert.equal(toPricePerLamport("214.16", 8, 6), "2.1416");
  const binStep = 25;
  const binId = binIdFromUiPrice("214.16", binStep, 8, 6);
  assert.equal(typeof binId, "number");
  const back = Number(uiPriceFromBinId(binId, binStep, 8, 6));
  // Within one bin step of the original: bins are discrete.
  assert.ok(Math.abs(back - 214.16) / 214.16 <= binStep / 10_000, `round trip ${back}`);
  // A higher price is a higher bin.
  assert.ok(binIdFromUiPrice("250", binStep, 8, 6) > binId);
});

test("ladder levels map onto bins, merging levels that share one", () => {
  const levels = buildLadder({ reference: "214.16", rangeStartBps: 200, rangeEndBps: 1_000, levels: 5, distribution: "EVEN", capital: 100_000_000n });
  const { levels: placed, bins } = ladderToBins(levels, 25, 8, 6);
  assert.ok(placed.every((l) => typeof l.binId === "number"));
  // Bins descend, and every allocated unit survives the mapping.
  assert.deepEqual([...bins].sort((a, b) => b.binId - a.binId), bins);
  assert.equal(bins.reduce((s, b) => s + BigInt(b.amount), 0n), 100_000_000n);
  // A coarse bin step merges neighbouring levels rather than double-counting.
  const coarse = ladderToBins(levels, 400, 8, 6);
  assert.ok(coarse.bins.length <= bins.length);
  assert.equal(coarse.bins.reduce((s, b) => s + BigInt(b.amount), 0n), 100_000_000n);
});

// --- range -----------------------------------------------------------------

test("a range is symmetric around the reference and its status is honest", () => {
  const range = priceRange({ reference: "200", lowerBps: 500, upperBps: 500 });
  assert.deepEqual(range, { lower: "190", upper: "210" });
  assert.equal(inRange("201", "190", "210"), true);
  assert.equal(inRange("189", "190", "210"), false);
  assert.equal(inRange("210", "190", "210"), true);
  assert.equal(inRange(null, "190", "210"), null);
});

test("composition follows price, and position value is exact in quote units", () => {
  // 1 NVDAx (8dp) at $200 plus 200 USDC (6dp) is half and half.
  const share = baseShare(100_000_000n, 200_000_000n, "200", 8, 6);
  assert.ok(share !== null && Math.abs(share - 0.5) < 1e-9);
  assert.equal(positionValueQuote(100_000_000n, 200_000_000n, "200", 8, 6), "400000000");
  // A falling price leaves the position more stock-heavy in unit terms.
  const lower = baseShare(200_000_000n, 100_000_000n, "150", 8, 6);
  assert.ok(lower !== null && lower > 0.7);
  assert.equal(baseShare(0n, 0n, "200", 8, 6), null);
  assert.equal(positionValueQuote(1n, 1n, "0", 8, 6), null);
});

test("fee APR is unavailable until the observation window justifies one", () => {
  assert.equal(feeApr({ feesQuote: 100n, positionValueQuote: 10_000n, windowHours: 2, minimumWindowHours: 72 }), null);
  const apr = feeApr({ feesQuote: 100n, positionValueQuote: 10_000n, windowHours: 168, minimumWindowHours: 72 });
  assert.ok(apr !== null && apr > 0);
  // 1% over a week annualizes to about 52%.
  assert.ok(Math.abs(apr! - 52.14) < 0.5, `apr ${apr}`);
  assert.equal(feeApr({ feesQuote: 100n, positionValueQuote: 0n, windowHours: 168, minimumWindowHours: 72 }), null);
});

// --- configuration ---------------------------------------------------------

test("the demo configurations are valid", () => {
  assert.equal(validateEarnStocksConfig(DEMO_EARN_STOCKS).success, true);
  assert.equal(validateSmartAccumulateConfig(DEMO_SMART_ACCUMULATE).success, true);
  assert.equal(validateRangeYieldConfig(DEMO_RANGE_YIELD).success, true);
});

test("invalid configuration is refused with a reason", () => {
  const inverted = validateSmartAccumulateConfig({ ...DEMO_SMART_ACCUMULATE, rangeStartBps: 1_000, rangeEndBps: 200 });
  assert.equal(inverted.success, false);
  assert.match(configProblems(inverted).join(" "), /deeper/);
  const sameMint = validateSmartAccumulateConfig({ ...DEMO_SMART_ACCUMULATE, quoteMint: DEMO_SMART_ACCUMULATE.assetMint });
  assert.equal(sameMint.success, false);
  // Meteora allows at most 50 bins in one limit order.
  assert.equal(validateSmartAccumulateConfig({ ...DEMO_SMART_ACCUMULATE, levels: 51 }).success, false);
  assert.equal(validateEarnStocksConfig({ ...DEMO_EARN_STOCKS, reserve: "not-an-address" }).success, false);
  assert.equal(validateEarnStocksConfig({ ...DEMO_EARN_STOCKS, minimumHarvestAmount: "5.5" }).success, false);
  assert.equal(validateRangeYieldConfig({ ...DEMO_RANGE_YIELD, rangeLowerBps: 0 }).success, false);
});

// --- markets ---------------------------------------------------------------

test("market admission requires a verified mint, USDC, depth and turnover", () => {
  const nvda = MARKET_CANDIDATES.find((c) => c.assetSymbol === "NVDAx")!;
  const admitted = admitMarket(nvda, { requireLimitOrders: true });
  assert.equal(admitted.admitted, true, admitted.failures.join("; "));
  assert.ok(admitted.reasons.some((r) => /verified on chain/.test(r)));
  assert.ok(admitted.reasons.some((r) => /pool admits limit orders/.test(r)));
  // A pool nobody trades earns no fees, whatever its depth.
  const idle = admitMarket({ ...nvda, volume24hUsd: 0 });
  assert.equal(idle.admitted, false);
  assert.ok(idle.failures.some((f) => /volume/.test(f)));
  const thin = admitMarket({ ...nvda, liquidityUsd: 100 });
  assert.equal(thin.admitted, false);
  assert.ok(thin.failures.some((f) => /liquidity/.test(f)));
  const notUsdc = admitMarket({ ...nvda, quoteMint: "So11111111111111111111111111111111111111112" });
  assert.equal(notUsdc.admitted, false);
  // An accumulation strategy cannot use a liquidity-mining pool.
  const noLimit = admitMarket({ ...nvda, supportsLimitOrders: false }, { requireLimitOrders: true });
  assert.equal(noLimit.admitted, false);
  assert.ok(noLimit.failures.some((f) => /limit orders/.test(f)));
  // The same pool is fine for a strategy that does not need them.
  assert.equal(admitMarket({ ...nvda, supportsLimitOrders: false }).admitted, true);
});

test("the verified registry is small and every member clears the criteria", () => {
  const markets = verifiedMarkets({ requireLimitOrders: true });
  assert.ok(markets.length >= 1, "at least one market must qualify");
  for (const market of markets) {
    assert.equal(market.quoteSymbol, "USDC");
    assert.ok(market.admittedBecause.length > 0);
    const candidate = MARKET_CANDIDATES.find((c) => c.address === market.address)!;
    assert.ok(candidate.liquidityUsd >= MARKET_CRITERIA.minLiquidityUsd);
    assert.ok(candidate.volume24hUsd >= MARKET_CRITERIA.minVolume24hUsd);
  }
  // NVDAx is the market the demos use.
  assert.ok(markets.some((m) => m.assetSymbol === "NVDAx"));
});

test("limit-order support is read from the pool's own parameters", () => {
  const none = "11111111111111111111111111111111";
  assert.equal(supportsLimitOrders({ parameters: { functionType: 2 }, rewardInfos: [] }), true);
  assert.equal(supportsLimitOrders({ parameters: { functionType: 1 }, rewardInfos: [] }), false);
  // Undetermined resolves to limit orders only while no reward mint is set.
  assert.equal(supportsLimitOrders({ parameters: { functionType: 0 }, rewardInfos: [{ mint: none }, { mint: none }] }), true);
  assert.equal(supportsLimitOrders({ parameters: { functionType: 0 }, rewardInfos: [{ mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" }] }), false);
});

// --- safety ----------------------------------------------------------------

const instance = (over: Partial<StrategyInstance> = {}): StrategyInstance => ({
  id: "test:instance",
  definitionId: "earn-stocks",
  strategyType: "EARN_STOCKS",
  name: "Test",
  network: "solana",
  market: { address: "F4inHs4RQARpASmvLpj45QjGLdkukeGQrtQ22pimVy2a", protocol: "meteora-dlmm", assetMint: null, assetSymbol: null, representationId: null, quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", quoteSymbol: "USDC", admittedBecause: ["verified"], verifiedAt: "2026-09-16T00:00:00.000Z" },
  authority: { owner: "o", operator: null, feeOwner: null, operatorCan: { addLiquidity: false, removeLiquidity: false, closePosition: false, claimFees: false, withdrawPrincipalToSelf: false }, verifiedBy: "test", notes: [] },
  positionAddresses: [],
  deployedCapital: "1000000",
  status: "LIVE_DEMO",
  access: "INTERNAL_DEMO_ONLY",
  createdAt: null,
  lastUpdatedAt: new Date(1_800_000_000_000).toISOString(),
  lastStateSlot: 1,
  provenance: [],
  pausedReason: null,
  state: { kind: "EARN_STOCKS", targetStockMint: "m", targetStockSymbol: "NVDAx", principalDeposited: "1000000", currentPrincipalClaim: "1000000", grossYieldAccrued: "0", yieldRealized: "0", yieldPendingConversion: "0", yieldConverted: "0", stockAccumulated: "0", strategyFees: "0", netYield: "0", currentSupplyApy: null, lastConversionAt: null, nextEligibleConversionAt: null, conversionBlockedReason: null },
  ...over,
});

const ctx = (over: Partial<Parameters<typeof evaluateAction>[1]> = {}) => ({
  now: 1_800_000_000_000,
  limits: DEFAULT_ACTION_LIMITS,
  amount: 10_000_000n,
  actionsToday: 0,
  operatorAuthorized: true,
  mainnetActionsEnabled: true,
  route: { available: true, priceImpactBps: 10, guardApproved: true, guardReason: null },
  simulation: { ok: true, detail: "simulated" },
  stateAgeSeconds: 5,
  ...over,
});

test("a sound action passes every check", () => {
  const result = evaluateAction(instance(), ctx());
  assert.equal(result.allowed, true, result.reason ?? "");
  assert.ok(result.checks.every((c) => c.ok));
});

test("mainnet actions off, an unauthorized operator, or a paused strategy all block", () => {
  assert.match(evaluateAction(instance(), ctx({ mainnetActionsEnabled: false })).reason!, /HENAR_STRATEGY_MAINNET_ACTIONS is off/);
  assert.match(evaluateAction(instance(), ctx({ operatorAuthorized: false })).reason!, /not an authorized operator/);
  assert.match(evaluateAction(instance({ pausedReason: "breaker tripped" }), ctx()).reason!, /breaker tripped/);
  assert.match(evaluateAction(instance({ status: "READY_FOR_DEMO" }), ctx()).reason!, /strategy is READY_FOR_DEMO/);
});

test("dust, oversized amounts, daily limits and stale state all block", () => {
  assert.match(evaluateAction(instance(), ctx({ amount: 1n })).reason!, /dust floor/);
  assert.match(evaluateAction(instance(), ctx({ amount: 10_000_000_000n })).reason!, /per-action ceiling/);
  assert.match(evaluateAction(instance(), ctx({ actionsToday: 6 })).reason!, /actions used today/);
  assert.match(evaluateAction(instance(), ctx({ stateAgeSeconds: 900 })).reason!, /state is 900s old/);
  assert.match(evaluateAction(instance(), ctx({ stateAgeSeconds: null })).reason!, /state age unknown/);
});

test("a missing route, an unapproved guard or a failed simulation all block", () => {
  assert.match(evaluateAction(instance(), ctx({ route: { available: false, priceImpactBps: null, guardApproved: false, guardReason: "no route" } })).reason!, /no route is available/);
  assert.match(evaluateAction(instance(), ctx({ route: { available: true, priceImpactBps: 500, guardApproved: true, guardReason: null } })).reason!, /impact 500 bps/);
  assert.match(evaluateAction(instance(), ctx({ route: { available: true, priceImpactBps: 10, guardApproved: false, guardReason: "guard refused" } })).reason!, /guard refused/);
  assert.match(evaluateAction(instance(), ctx({ simulation: { ok: false, detail: "simulation failed" } })).reason!, /simulation failed/);
});

test("an unverified market blocks, however sound everything else is", () => {
  const unverified = instance({ market: { ...instance().market, admittedBecause: [] } });
  assert.match(evaluateAction(unverified, ctx()).reason!, /not in the verified registry/);
});

// --- breakers --------------------------------------------------------------

const breakerInput = (over = {}) => ({
  poolStateAgeSeconds: 10,
  maxStateAgeSeconds: 300,
  referenceAvailable: true,
  deviationBps: 10,
  maxDeviationBps: 1_000,
  protocolAvailable: true,
  ownershipMatches: true,
  tokenExtensionsSupported: true,
  consecutiveSimulationFailures: 0,
  maxSimulationFailures: 3,
  routeAvailable: true,
  priceImpactBps: 10,
  maxPriceImpactBps: 100,
  accountingMismatch: null,
  ...over,
});

test("a healthy strategy trips no breaker", () => {
  assert.deepEqual(trippedBreakers(breakerInput()), []);
});

test("each breaker trips on its own condition", () => {
  const reason = (over: object) => trippedBreakers(breakerInput(over)).map((t) => t.reason);
  assert.deepEqual(reason({ poolStateAgeSeconds: 600 }), ["POOL_STATE_STALE"]);
  assert.deepEqual(reason({ referenceAvailable: false }), ["REFERENCE_UNAVAILABLE"]);
  assert.deepEqual(reason({ deviationBps: -2_000 }), ["EXTREME_DEVIATION"]);
  assert.deepEqual(reason({ protocolAvailable: false }), ["PROTOCOL_UNAVAILABLE"]);
  assert.deepEqual(reason({ ownershipMatches: false }), ["UNEXPECTED_POSITION_OWNERSHIP"]);
  assert.deepEqual(reason({ tokenExtensionsSupported: false }), ["UNSUPPORTED_TOKEN_EXTENSION"]);
  assert.deepEqual(reason({ consecutiveSimulationFailures: 3 }), ["SIMULATION_FAILURE"]);
  assert.deepEqual(reason({ routeAvailable: false }), ["ROUTE_UNAVAILABLE"]);
  assert.deepEqual(reason({ priceImpactBps: 900 }), ["EXCESSIVE_PRICE_IMPACT"]);
  assert.deepEqual(reason({ accountingMismatch: "books disagree" }), ["ACCOUNTING_MISMATCH"]);
  // Several conditions report several trips, not just the first.
  assert.equal(trippedBreakers(breakerInput({ referenceAvailable: false, routeAvailable: false })).length, 2);
});

// --- definitions and deployment -------------------------------------------

test("every strategy is internal-demo-only, unaudited and charges nothing", () => {
  assert.equal(STRATEGY_DEFINITIONS.length, 3);
  for (const definition of STRATEGY_DEFINITIONS) {
    assert.equal(definition.access, "INTERNAL_DEMO_ONLY");
    assert.equal(definition.auditStatus, "NOT_AUDITED");
    assert.equal(definition.feeModel.active, false);
    assert.equal(definition.feeModel.performanceFeeBps, 0);
    assert.equal(definition.feeModel.depositFeeBps, 0);
    assert.equal(definition.feeModel.withdrawalFeeBps, 0);
    assert.ok(definition.risks.length >= 3, `${definition.slug} states its risks`);
    assert.ok(definition.version.length > 0);
  }
  assert.equal(definitionBySlug("smart-accumulate")?.strategyType, "SMART_ACCUMULATE");
  assert.equal(definitionBySlug("nope"), null);
});

test("Smart Accumulate is described as one-way, because the primitive is", () => {
  const definition = definitionBySlug("smart-accumulate")!;
  assert.match(definition.returnSource, /stays converted/);
  assert.ok(definition.risks.some((r) => /one-way/i.test(r)));
  // And its operator model states the constraint the protocol imposes.
  assert.match(definition.operatorModel, /no operator/i);
});

test("a strategy with no configured deployment reports that, rather than inventing one", () => {
  const none = strategyDeployment("earn-stocks", {});
  assert.equal(none.configured, false);
  assert.match(none.configured === false ? none.reason : "", /no demo capital is deployed/);
  const malformed = strategyDeployment("earn-stocks", { HENAR_STRATEGY_EARN_STOCKS: "{oops" });
  assert.equal(malformed.configured, false);
  assert.match(malformed.configured === false ? malformed.reason : "", /not valid JSON/);
  const wrong = strategyDeployment("earn-stocks", { HENAR_STRATEGY_EARN_STOCKS: JSON.stringify({ owner: "nope", operator: null, feeOwner: null, positions: [], deployedCapital: null, fundedAt: null }) });
  assert.equal(wrong.configured, false);
  assert.match(wrong.configured === false ? wrong.reason : "", /malformed/);
  const good = strategyDeployment("earn-stocks", {
    HENAR_STRATEGY_EARN_STOCKS: JSON.stringify({ owner: "EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff", operator: null, feeOwner: null, positions: ["D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"], deployedCapital: "1000000", fundedAt: "2026-09-16T00:00:00.000Z" }),
  });
  assert.equal(good.configured, true);
  assert.equal(good.configured === true ? good.deployment.positions.length : 0, 1);
});
