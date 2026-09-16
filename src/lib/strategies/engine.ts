/**
 * Strategy engines: turn a definition plus its configuration and whatever the
 * protocols currently report into a live instance.
 *
 * Every engine follows the same rule about missing data. A value Henar cannot
 * verify is null and says why; it is never replaced by a zero, an estimate or
 * a plausible-looking number.
 */
import type { Connection } from "@solana/web3.js";
import { henarFlag } from "@/lib/feature-flags";
import { provenance, SOURCES } from "@/lib/provenance";
import { fairValueForMint } from "@/lib/pyth/company";
import { accountingMismatch, averagePrice, raw, shouldHarvest, toBig } from "./accounting";
import { kaminoPosition, KAMINO_SOURCE, positionYield, reserveSnapshot, type KaminoAdapterDeps } from "./adapters/kamino";
import { dlmmAuthorityFacts, readLimitOrders, readPool, readPositions, METEORA_SOURCE } from "./adapters/meteora";
import { DEMO_EARN_STOCKS, DEMO_RANGE_YIELD, DEMO_SMART_ACCUMULATE, EARN_STOCKS, RANGE_YIELD, SMART_ACCUMULATE } from "./definitions";
import { strategyDeployment, type StrategyDeployment } from "./deployment";
import { baseShare, buildLadder, feeApr, inRange, ladderProgress, ladderToBins, positionValueQuote, priceRange, uiPriceFromBinId } from "./ladder";
import { marketByAddress, verifiedMarkets } from "./markets";
import type { AuthorityModel, EarnStocksState, RangeYieldState, SmartAccumulateState, StrategyInstance, StrategyMarket } from "./types";

/** A fee APR needs a window worth annualizing. Below this it is unavailable. */
const MIN_FEE_APR_WINDOW_HOURS = 72;

export type EngineDeps = {
  connection?: Connection | null;
  kamino?: KaminoAdapterDeps;
  now?: () => number;
  /** Reference price resolver. Defaults to the Pyth fair-value layer. */
  reference?: (mint: string) => Promise<{ price: string; source: string } | null>;
};

/** Pyth first, since it is the reference the rest of Henar already uses. */
async function referenceFor(mint: string, deps: EngineDeps) {
  if (deps.reference) return deps.reference(mint);
  if (!henarFlag("pythPro")) return null;
  try {
    const assessment = await fairValueForMint(mint, null);
    const price = assessment?.tokenReference?.price ?? assessment?.underlyingReference?.price ?? null;
    if (!price) return null;
    const source = assessment?.tokenReference ? `Pyth ${assessment.tokenReference.symbol}` : `Pyth ${assessment?.underlyingReference?.symbol ?? "reference"}`;
    return { price, source };
  } catch {
    return null;
  }
}

function authorityFor(deployment: StrategyDeployment | null, kind: "kamino" | "dlmm-position" | "dlmm-limit-order"): AuthorityModel {
  const owner = deployment?.owner ?? "not deployed";
  if (kind === "kamino")
    return {
      owner,
      operator: null,
      feeOwner: null,
      operatorCan: { addLiquidity: false, removeLiquidity: false, closePosition: false, claimFees: false, withdrawPrincipalToSelf: false },
      verifiedBy: "@kamino-finance/klend-sdk 12.0.0: deposit and withdraw instructions require the obligation owner as signer; klend defines no delegate",
      notes: ["Only the owner can withdraw.", "A supply-only position carries no debt and cannot be liquidated."],
    };
  if (kind === "dlmm-limit-order")
    return {
      owner,
      operator: null,
      feeOwner: null,
      operatorCan: { addLiquidity: false, removeLiquidity: false, closePosition: false, claimFees: false, withdrawPrincipalToSelf: false },
      verifiedBy: "@meteora-ag/dlmm 1.9.14: cancel_limit_order and close_limit_order_if_empty require owner [SIGNER]; no operator account exists",
      notes: ["A keeper may place an order for an owner but can never settle or cancel one.", "Limit-order fees settle together with principal; there is no separate claim."],
    };
  const facts = dlmmAuthorityFacts();
  return { owner, operator: deployment?.operator ?? null, feeOwner: deployment?.feeOwner ?? null, ...facts };
}

function marketFor(address: string): StrategyMarket {
  const candidate = marketByAddress(address);
  const admitted = verifiedMarkets({ requireLimitOrders: false }).find((m) => m.address === address);
  if (admitted) return admitted;
  return {
    address,
    protocol: "meteora-dlmm",
    assetMint: candidate?.assetMint ?? null,
    assetSymbol: candidate?.assetSymbol ?? null,
    representationId: null,
    quoteMint: candidate?.quoteMint ?? "",
    quoteSymbol: candidate?.quoteSymbol ?? "USDC",
    admittedBecause: [],
    verifiedAt: candidate?.observedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Earn Stocks
// ---------------------------------------------------------------------------

export async function earnStocksInstance(deps: EngineDeps = {}): Promise<StrategyInstance> {
  const now = deps.now?.() ?? Date.now();
  const config = DEMO_EARN_STOCKS;
  const deployment = strategyDeployment(EARN_STOCKS.slug);
  const live = deployment.configured ? deployment.deployment : null;
  const reserve = await reserveSnapshot(config.market, config.reserve).catch(() => null);
  const position = live ? await kaminoPosition({ market: config.market, reserve: config.reserve, owner: live.owner }, { ...deps.kamino, now: deps.now }) : null;
  const basis = live?.basis ?? null;
  const yieldRead = position ? positionYield(position, basis ?? null) : { accrued: null, reason: deployment.configured ? "no position" : deployment.reason };

  const principalDeposited = live?.deployedCapital ?? "0";
  const accrued = yieldRead.accrued;
  const harvest = accrued === null
    ? { harvest: false as const, amount: 0n, reason: yieldRead.reason ?? "yield is not measurable yet" }
    : shouldHarvest({
        accrued,
        minimumAmount: toBig(config.minimumHarvestAmount),
        maximumAmount: toBig(config.maximumConversionAmount),
        lastHarvestAt: null,
        minimumIntervalMs: config.minimumHarvestIntervalHours * 3_600_000,
        now,
      });

  const mismatch = accountingMismatch({
    ledgerPrincipal: toBig(principalDeposited),
    protocolPrincipal: position?.liquidityValue === null || position?.liquidityValue === undefined ? null : toBig(position.liquidityValue) - (accrued ?? 0n),
    toleranceBps: 50,
  });

  const state: EarnStocksState = {
    kind: "EARN_STOCKS",
    targetStockMint: config.targetStockMint,
    targetStockSymbol: config.targetStockSymbol,
    principalDeposited,
    currentPrincipalClaim: position?.liquidityValue ?? null,
    grossYieldAccrued: accrued === null ? null : raw(accrued),
    yieldRealized: "0",
    yieldPendingConversion: "0",
    yieldConverted: "0",
    stockAccumulated: "0",
    strategyFees: "0",
    netYield: "0",
    currentSupplyApy: reserve?.supplyApy ?? null,
    lastConversionAt: null,
    nextEligibleConversionAt: null,
    conversionBlockedReason: harvest.harvest ? null : harvest.reason,
  };

  return {
    id: "earn-stocks:nvdax",
    definitionId: EARN_STOCKS.id,
    strategyType: "EARN_STOCKS",
    name: `Earn ${config.targetStockSymbol.replace(/x$/, "")}`,
    network: "solana",
    market: {
      address: config.reserve,
      protocol: "kamino",
      assetMint: config.targetStockMint,
      assetSymbol: config.targetStockSymbol,
      representationId: null,
      quoteMint: config.yieldAssetMint,
      quoteSymbol: "USDC",
      admittedBecause: reserve ? [`Kamino reserve with ${reserve.supplyApy === null ? "an unpublished" : `a ${reserve.supplyApy.toFixed(2)}%`} supply rate`] : [],
      verifiedAt: reserve?.observedAt ?? new Date(now).toISOString(),
    },
    authority: authorityFor(live, "kamino"),
    positionAddresses: live?.positions ?? [],
    deployedCapital: live?.deployedCapital ?? null,
    status: live && live.positions.length ? (mismatch ? "DEGRADED" : "LIVE_DEMO") : EARN_STOCKS.status,
    access: EARN_STOCKS.access,
    createdAt: live?.fundedAt ?? null,
    lastUpdatedAt: new Date(now).toISOString(),
    lastStateSlot: position?.slot ?? null,
    provenance: [
      provenance({ ...KAMINO_SOURCE, sourceType: "provider-catalog", observedAt: reserve?.observedAt ?? new Date(now).toISOString() }),
      ...(position?.status === "available" ? [position.provenance] : []),
    ],
    pausedReason: mismatch ?? (deployment.configured ? null : null),
    state,
  };
}

// ---------------------------------------------------------------------------
// Smart Accumulate
// ---------------------------------------------------------------------------

export async function smartAccumulateInstance(deps: EngineDeps = {}): Promise<StrategyInstance> {
  const now = deps.now?.() ?? Date.now();
  const config = DEMO_SMART_ACCUMULATE;
  const deployment = strategyDeployment(SMART_ACCUMULATE.slug);
  const live = deployment.configured ? deployment.deployment : null;
  const pool = deps.connection ? await readPool(deps.connection, config.pool, { now: deps.now }) : null;
  const reference = await referenceFor(config.assetMint, deps);

  /* The ladder is built from the reference the strategy was configured
     against. Without one there is no ladder to show, which is a different
     statement from an empty ladder. */
  /* The configured preference is Pyth, but if Pyth has nothing the ladder is
     built from the pool's own active price. Reporting the configured source
     either way would credit Pyth for a number it did not produce. */
  const referenceSource = reference ? config.referenceSource : "executable-route";
  const referencePrice = reference?.price ?? pool?.activePrice ?? null;
  const levels = referencePrice
    ? buildLadder({ reference: referencePrice, rangeStartBps: config.rangeStartBps, rangeEndBps: config.rangeEndBps, levels: config.levels, distribution: config.distribution, capital: toBig(config.capital) })
    : [];

  const orders = deps.connection && live ? await readLimitOrders(deps.connection, config.pool, live.owner, { now: deps.now }) : null;
  const binStep = pool?.binStep ?? null;
  const baseDecimals = pool?.baseDecimals ?? null;
  const quoteDecimals = pool?.quoteDecimals ?? null;

  /* Levels are placed on bins by the same maths that would build the order,
     so a level can be matched to what the protocol reports. Without the
     pool's bin step there is no mapping, and levels stay unplaced rather
     than being assigned a guessed bin. */
  const placed = binStep !== null && baseDecimals !== null && quoteDecimals !== null && levels.length
    ? ladderToBins(levels, binStep, baseDecimals, quoteDecimals).levels
    : levels;

  /* Fills come from the protocol's own per-bin order status. A level whose
     bin the protocol does not report stays pending. */
  const statusByBin = new Map<number, "NotFilled" | "PartialFilled" | "Fulfilled">();
  for (const order of orders?.orders ?? []) for (const bin of order.bins) statusByBin.set(bin.binId, bin.status);

  const mapped = placed.map((level) => {
    const status = level.binId === null ? undefined : statusByBin.get(level.binId);
    if (!status || status === "NotFilled") return level;
    return { ...level, status: status === "Fulfilled" ? ("filled" as const) : ("partial" as const) };
  });
  const progress = ladderProgress(mapped);

  const filledQuote = (orders?.orders ?? []).reduce((sum, o) => sum + (Number(o.totalDepositQuote) - Number(o.totalUnfilledQuote)), 0);
  const acquiredBase = (orders?.orders ?? []).reduce((sum, o) => sum + Number(o.totalFilledBase), 0);

  const state: SmartAccumulateState = {
    kind: "SMART_ACCUMULATE",
    initialUSDC: config.capital,
    remainingUSDC: orders?.status === "available" ? raw(BigInt(Math.round((orders.orders.reduce((s, o) => s + Number(o.totalUnfilledQuote), 0)) * 10 ** (quoteDecimals ?? 6)))) : live ? null : config.capital,
    stockAcquired: orders?.status === "available" ? raw(BigInt(Math.round(acquiredBase * 10 ** (baseDecimals ?? 8)))) : null,
    averageAcquisitionPrice:
      orders?.status === "available" && acquiredBase > 0 && quoteDecimals !== null && baseDecimals !== null
        ? averagePrice(BigInt(Math.round(filledQuote * 10 ** quoteDecimals)), BigInt(Math.round(acquiredBase * 10 ** baseDecimals)), quoteDecimals, baseDecimals)
        : null,
    feesEarned:
      orders?.status === "available"
        ? {
            base: raw(BigInt(Math.round(orders.orders.reduce((s, o) => s + Number(o.totalFeeBase), 0) * 10 ** (baseDecimals ?? 8)))),
            quote: raw(BigInt(Math.round(orders.orders.reduce((s, o) => s + Number(o.totalFeeQuote), 0) * 10 ** (quoteDecimals ?? 6)))),
          }
        : null,
    referenceSource,
    referencePrice,
    currentReference: pool?.activePrice ?? null,
    rangeStart: levels[0]?.price ?? "0",
    rangeEnd: levels[levels.length - 1]?.price ?? "0",
    distribution: config.distribution,
    levels: mapped,
    levelsFilled: progress.levelsFilled,
    levelsRemaining: progress.levelsRemaining,
    /* The protocol's limit-order fills are monotonic: once a bin's order age
       passes the order's, the fill is permanent. That is why this strategy
       uses limit orders and not a one-sided LP position. */
    reversible: false,
    reversibilityNote: "Meteora records limit-order fills with a monotonic order-age counter, so a filled level stays filled if price recovers.",
  };

  return {
    id: "smart-accumulate:nvdax",
    definitionId: SMART_ACCUMULATE.id,
    strategyType: "SMART_ACCUMULATE",
    name: `Smart Accumulate ${config.assetSymbol.replace(/x$/, "")}`,
    network: "solana",
    market: marketFor(config.pool),
    authority: authorityFor(live, "dlmm-limit-order"),
    positionAddresses: orders?.orders.map((o) => o.address) ?? live?.positions ?? [],
    deployedCapital: live?.deployedCapital ?? null,
    status: live && (orders?.orders.length ?? 0) > 0 ? "LIVE_DEMO" : SMART_ACCUMULATE.status,
    access: SMART_ACCUMULATE.access,
    createdAt: live?.fundedAt ?? null,
    lastUpdatedAt: new Date(now).toISOString(),
    lastStateSlot: pool?.slot ?? null,
    provenance: [
      provenance({ ...METEORA_SOURCE, observedAt: pool?.readAt ?? new Date(now).toISOString() }),
      ...(reference ? [provenance({ ...SOURCES.pyth, observedAt: new Date(now).toISOString() })] : []),
    ],
    pausedReason: pool?.supportsLimitOrders === false ? "pool does not admit limit orders" : null,
    state,
  };
}

// ---------------------------------------------------------------------------
// Range Yield
// ---------------------------------------------------------------------------

export async function rangeYieldInstance(deps: EngineDeps = {}): Promise<StrategyInstance> {
  const now = deps.now?.() ?? Date.now();
  const config = DEMO_RANGE_YIELD;
  const deployment = strategyDeployment(RANGE_YIELD.slug);
  const live = deployment.configured ? deployment.deployment : null;
  const pool = deps.connection ? await readPool(deps.connection, config.pool, { now: deps.now }) : null;
  const reference = await referenceFor(config.assetMint, deps);
  const positions = deps.connection && live ? await readPositions(deps.connection, config.pool, live.owner, { now: deps.now }) : null;

  /* Only a real Pyth reference is reported as one; the pool price is a
     different thing and is labelled as the current price, not fair value. */
  const referencePrice = reference?.price ?? null;
  const currentPrice = pool?.activePrice ?? null;
  const rangeBasis = referencePrice ?? currentPrice;
  const range = rangeBasis ? priceRange({ reference: rangeBasis, lowerBps: config.rangeLowerBps, upperBps: config.rangeUpperBps }) : null;

  const position = positions?.positions[0] ?? null;
  const baseDecimals = pool?.baseDecimals ?? 8;
  const quoteDecimals = pool?.quoteDecimals ?? 6;
  const baseAmount = position ? toBig(position.baseAmountNet) : null;
  const quoteAmount = position ? toBig(position.quoteAmountNet) : null;

  const lower = position && pool?.binStep ? uiPriceFromBinId(position.lowerBinId, pool.binStep, baseDecimals, quoteDecimals) : range?.lower ?? "0";
  const upper = position && pool?.binStep ? uiPriceFromBinId(position.upperBinId, pool.binStep, baseDecimals, quoteDecimals) : range?.upper ?? "0";

  const value = baseAmount !== null && quoteAmount !== null && currentPrice ? positionValueQuote(baseAmount, quoteAmount, currentPrice, baseDecimals, quoteDecimals) : null;
  const feesQuote = position ? toBig(position.feeQuoteNet) : 0n;
  const windowHours = position && live?.fundedAt ? (now - Date.parse(live.fundedAt)) / 3_600_000 : 0;

  const state: RangeYieldState = {
    kind: "RANGE_YIELD",
    lowerPrice: lower,
    upperPrice: upper,
    lowerBinId: position?.lowerBinId ?? null,
    upperBinId: position?.upperBinId ?? null,
    activeBinId: pool?.activeBinId ?? null,
    currentPrice,
    pythFairValue: referencePrice,
    inRange: currentPrice ? inRange(currentPrice, lower, upper) : null,
    baseAmount: baseAmount === null ? null : raw(baseAmount),
    quoteAmount: quoteAmount === null ? null : raw(quoteAmount),
    baseShare: baseAmount !== null && quoteAmount !== null && currentPrice ? baseShare(baseAmount, quoteAmount, currentPrice, baseDecimals, quoteDecimals) : null,
    positionValueQuote: value,
    feesUnclaimed: position ? { base: position.feeBaseNet, quote: position.feeQuoteNet } : null,
    feesClaimed: position ? { base: position.claimedFeeBase, quote: position.claimedFeeQuote } : { base: "0", quote: "0" },
    /* Annualizing a few hours of fees produces a number, not a rate. Below
       the minimum window this stays null and the UI says so. */
    feeApr:
      position && value
        ? (() => {
            const apr = feeApr({ feesQuote, positionValueQuote: toBig(value), windowHours, minimumWindowHours: MIN_FEE_APR_WINDOW_HOURS });
            return apr === null ? null : { value: apr, windowHours: Math.round(windowHours), source: "observed fees since funding" };
          })()
        : null,
    distribution: config.distributionStrategy,
  };

  const ownershipMismatch = position && live && position.positionOwner !== live.owner ? "position is not owned by the configured owner" : null;

  return {
    id: "range-yield:nvdax",
    definitionId: RANGE_YIELD.id,
    strategyType: "RANGE_YIELD",
    name: `${config.assetSymbol.replace(/x$/, "")} Range Yield`,
    network: "solana",
    market: marketFor(config.pool),
    authority: authorityFor(live, "dlmm-position"),
    positionAddresses: positions?.positions.map((p) => p.address) ?? live?.positions ?? [],
    deployedCapital: live?.deployedCapital ?? null,
    status: position ? (ownershipMismatch ? "DEGRADED" : "LIVE_DEMO") : RANGE_YIELD.status,
    access: RANGE_YIELD.access,
    createdAt: live?.fundedAt ?? null,
    lastUpdatedAt: new Date(now).toISOString(),
    lastStateSlot: pool?.slot ?? null,
    provenance: [
      provenance({ ...METEORA_SOURCE, observedAt: pool?.readAt ?? new Date(now).toISOString() }),
      ...(reference ? [provenance({ ...SOURCES.pyth, observedAt: new Date(now).toISOString() })] : []),
    ],
    pausedReason: ownershipMismatch,
    state,
  };
}

/** Every strategy instance. A failure in one never takes the others down. */
export async function loadStrategyInstances(deps: EngineDeps = {}): Promise<StrategyInstance[]> {
  const results = await Promise.allSettled([earnStocksInstance(deps), smartAccumulateInstance(deps), rangeYieldInstance(deps)]);
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export async function strategyInstanceBySlug(slug: string, deps: EngineDeps = {}) {
  if (slug === EARN_STOCKS.slug) return earnStocksInstance(deps);
  if (slug === SMART_ACCUMULATE.slug) return smartAccumulateInstance(deps);
  if (slug === RANGE_YIELD.slug) return rangeYieldInstance(deps);
  return null;
}
