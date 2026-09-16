/**
 * Strategy configuration and its validation.
 *
 * Every strategy parameter is explicit and checked before anything reads it.
 * A malformed configuration is an error at load, not a surprise at execution.
 */
import { z } from "zod";

const bps = z.number().int().min(0).max(10_000);
const positiveInt = z.number().int().positive();
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "not a base58 address");
const rawAmount = z.string().regex(/^\d+$/, "not a base-unit integer");

export const earnStocksConfigSchema = z.object({
  /** Kamino lending market holding the reserve. */
  market: base58,
  /** Reserve pinned by address: a market can hold several USDC reserves. */
  reserve: base58,
  /** The asset supplied. USDC today. */
  yieldAssetMint: base58,
  yieldAssetDecimals: z.number().int().min(0).max(18),
  /** The stock realized yield is converted into. */
  targetStockMint: base58,
  targetStockSymbol: z.string().min(1).max(20),
  /** Below this, converting costs more than it gains. Base units of the yield asset. */
  minimumHarvestAmount: rawAmount,
  /** Never convert more often than this. */
  minimumHarvestIntervalHours: z.number().positive(),
  /** Refuse a conversion whose route impact exceeds this. */
  maximumConversionImpactBps: bps,
  /** Ceiling on one conversion, base units of the yield asset. */
  maximumConversionAmount: rawAmount,
});
export type EarnStocksConfig = z.infer<typeof earnStocksConfigSchema>;

export const smartAccumulateConfigSchema = z
  .object({
    /** DLMM pool. Must support limit orders. */
    pool: base58,
    assetMint: base58,
    assetSymbol: z.string().min(1).max(20),
    quoteMint: base58,
    quoteSymbol: z.string().min(1).max(20),
    referenceSource: z.enum(["pyth-fair-value", "executable-route"]),
    /** Where accumulation starts, below the reference. 200 = 2% below. */
    rangeStartBps: bps,
    /** Where it is fully allocated. Must be deeper than the start. */
    rangeEndBps: bps,
    distribution: z.enum(["EVEN", "DEEPER_DIP"]),
    /** Ladder rungs. Meteora allows at most 50 bins per limit order. */
    levels: positiveInt.max(50),
    /** Quote-asset base units to deploy across the ladder. */
    capital: rawAmount,
  })
  .refine((c) => c.rangeEndBps > c.rangeStartBps, { message: "rangeEndBps must be deeper than rangeStartBps" })
  .refine((c) => c.assetMint !== c.quoteMint, { message: "asset and quote must differ" });
export type SmartAccumulateConfig = z.infer<typeof smartAccumulateConfigSchema>;

export const rangeYieldConfigSchema = z
  .object({
    pool: base58,
    assetMint: base58,
    assetSymbol: z.string().min(1).max(20),
    quoteMint: base58,
    quoteSymbol: z.string().min(1).max(20),
    referenceSource: z.enum(["pyth-fair-value", "executable-route"]),
    /** Range below the reference. 500 = 5% below. */
    rangeLowerBps: bps,
    /** Range above the reference. */
    rangeUpperBps: bps,
    distributionStrategy: z.enum(["SPOT", "CURVE", "BID_ASK"]),
    /** Stock-side base units. */
    baseCapital: rawAmount,
    /** Quote-side base units. */
    quoteCapital: rawAmount,
    /** Claim fees only once they are worth the transaction. Quote base units. */
    minimumFeeClaimAmount: rawAmount,
  })
  .refine((c) => c.rangeLowerBps > 0 && c.rangeUpperBps > 0, { message: "range must be non-zero on both sides" })
  .refine((c) => c.assetMint !== c.quoteMint, { message: "asset and quote must differ" });
export type RangeYieldConfig = z.infer<typeof rangeYieldConfigSchema>;

export type StrategyConfig = EarnStocksConfig | SmartAccumulateConfig | RangeYieldConfig;

/** Limits every automated action obeys, whatever the strategy. */
export const actionLimitsSchema = z.object({
  /** Below this the action is dust and is skipped. */
  dustThreshold: rawAmount,
  /** Ceiling on a single action's amount. */
  maxActionAmount: rawAmount,
  /** Executions allowed per strategy per rolling day. */
  maxActionsPerDay: positiveInt,
  /** State older than this is stale and blocks action. */
  maxStateAgeSeconds: positiveInt,
  /** Route impact ceiling for a strategy-initiated swap. */
  maxPriceImpactBps: bps,
  /** Consecutive failures that trip the breaker. */
  breakerFailureThreshold: positiveInt,
});
export type ActionLimits = z.infer<typeof actionLimitsSchema>;

export const DEFAULT_ACTION_LIMITS: ActionLimits = {
  dustThreshold: "1000000", // 1 USDC: below this a swap's costs dominate.
  maxActionAmount: "100000000", // 100 USDC per action while this is a demo.
  maxActionsPerDay: 6,
  maxStateAgeSeconds: 300,
  maxPriceImpactBps: 100,
  breakerFailureThreshold: 3,
};

export function validateEarnStocksConfig(value: unknown) {
  return earnStocksConfigSchema.safeParse(value);
}
export function validateSmartAccumulateConfig(value: unknown) {
  return smartAccumulateConfigSchema.safeParse(value);
}
export function validateRangeYieldConfig(value: unknown) {
  return rangeYieldConfigSchema.safeParse(value);
}

/** Problems as plain sentences, for logs and diagnostics. */
export function configProblems(result: z.SafeParseReturnType<unknown, unknown>) {
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`);
}
