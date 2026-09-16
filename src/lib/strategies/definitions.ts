/**
 * The three strategies, and the demo instances configured for them.
 *
 * Every definition is explicit about what a depositor would put in, where the
 * return comes from, and what can go wrong. All three are team-funded and
 * closed to public capital; nothing here implies otherwise.
 */
import { KAMINO } from "./adapters/kamino";
import { METEORA } from "./adapters/meteora";
import { USDC_MINT } from "./markets";
import type { EarnStocksConfig, RangeYieldConfig, SmartAccumulateConfig } from "./config";
import type { FeeModel, StrategyDefinition } from "./types";

/** Zero, and inactive. The architecture supports a later fee on realized yield only. */
const PREVIEW_FEES: FeeModel = {
  depositFeeBps: 0,
  withdrawalFeeBps: 0,
  performanceFeeBps: 0,
  performanceFeeBasis: "realized-yield",
  active: false,
};

const LP_FEES: FeeModel = { ...PREVIEW_FEES, performanceFeeBasis: "realized-lp-fees" };

export const EARN_STOCKS: StrategyDefinition = {
  id: "earn-stocks",
  slug: "earn-stocks",
  name: "Earn Stocks",
  summary: "Keep your cash earning, and buy stock with the interest.",
  deposits: "USDC",
  returnSource: "Lending interest on Kamino, converted into stock through the Henar Router",
  strategyType: "EARN_STOCKS",
  protocols: ["Kamino", "Henar Router"],
  supportedAssets: ["NVDAx"],
  supportedQuoteAssets: ["USDC"],
  riskLevel: "MODERATE",
  riskSummary: "Principal stays in USDC and is never converted. The stock position grows only from interest actually earned.",
  risks: [
    "Lending carries protocol risk: a Kamino reserve can suffer bad debt, and withdrawals depend on the reserve holding free liquidity.",
    "The supply rate is variable and can fall to near zero, in which case the strategy accumulates nothing.",
    "Stock bought with yield carries the stock's own price risk and the issuer's redemption terms.",
    "Henar is not audited for custody of anyone else's capital, which is why this strategy holds none.",
  ],
  operatorModel: "Henar owns the Kamino position. Kamino has no operator or delegate, so only the owner can withdraw, and conversions are proposed by the runner and signed by an authorized operator.",
  feeModel: PREVIEW_FEES,
  access: "INTERNAL_DEMO_ONLY",
  auditStatus: "NOT_AUDITED",
  status: "READY_FOR_DEMO",
  version: "v1",
  docsUrl: KAMINO.docsUrl,
};

export const SMART_ACCUMULATE: StrategyDefinition = {
  id: "smart-accumulate",
  slug: "smart-accumulate",
  name: "Smart Accumulate",
  summary: "Buy a stock progressively as its price falls into your range.",
  deposits: "USDC",
  returnSource: "Not yield. The return is the price paid: USDC converts into stock at levels below the reference, and stays converted.",
  strategyType: "SMART_ACCUMULATE",
  protocols: ["Meteora DLMM", "Pyth Pro"],
  supportedAssets: ["NVDAx"],
  supportedQuoteAssets: ["USDC"],
  riskLevel: "HIGH",
  riskSummary: "Capital converts into stock as price falls, and the conversion is permanent. A price that keeps falling means holding more stock at a loss.",
  risks: [
    "Filling is not guaranteed: an order only fills if trading reaches its level and consumes the liquidity there.",
    "Fills are one-way. If price falls through every level and then recovers, the stock is held at the prices it was bought at, not sold back.",
    "A price that never reaches the range leaves the USDC unconverted and idle.",
    "Only the position owner can settle a filled order, so proceeds are collected by an authorized signer rather than automatically.",
  ],
  operatorModel: "Henar owns the limit orders. Meteora limit orders admit no operator: cancelling and settling require the owner's signature, so those actions are proposed and signed rather than automated.",
  feeModel: PREVIEW_FEES,
  access: "INTERNAL_DEMO_ONLY",
  auditStatus: "NOT_AUDITED",
  status: "READY_FOR_DEMO",
  version: "v1",
  docsUrl: METEORA.docsUrl,
};

export const RANGE_YIELD: StrategyDefinition = {
  id: "range-yield",
  slug: "range-yield",
  name: "Range Yield",
  summary: "Provide stock liquidity around a price range and earn the trading fees.",
  deposits: "Stock and USDC",
  returnSource: "Swap fees paid by traders while the position's liquidity is in range",
  strategyType: "RANGE_YIELD",
  protocols: ["Meteora DLMM", "Pyth Pro"],
  supportedAssets: ["NVDAx"],
  supportedQuoteAssets: ["USDC"],
  riskLevel: "VERY_HIGH",
  riskSummary: "This is concentrated-liquidity market making, not interest. The position becomes stock-heavy as price falls and cash-heavy as it rises, and earns nothing while price sits outside its range.",
  risks: [
    "Composition follows price: a falling stock leaves the position holding more of it, a rising one leaves it holding less.",
    "That path-dependence can leave the position worth less than simply having held the same assets, even after fees.",
    "Fees stop accruing meaningfully once price leaves the range.",
    "Fee income depends on trading volume, which for tokenized equities is small and irregular.",
  ],
  operatorModel: "Henar owns the position. An operator may manage liquidity but cannot receive principal, which the protocol routes to the owner; a keeper may claim fees to the fee owner without any power over capital.",
  feeModel: LP_FEES,
  access: "INTERNAL_DEMO_ONLY",
  auditStatus: "NOT_AUDITED",
  status: "READY_FOR_DEMO",
  version: "v1",
  docsUrl: METEORA.docsUrl,
};

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [EARN_STOCKS, SMART_ACCUMULATE, RANGE_YIELD];

export function definitionBySlug(slug: string) {
  return STRATEGY_DEFINITIONS.find((d) => d.slug === slug) ?? null;
}

// ---------------------------------------------------------------------------
// Demo configuration
// ---------------------------------------------------------------------------

const NVDAX_MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const NVDAX_POOL = "F4inHs4RQARpASmvLpj45QjGLdkukeGQrtQ22pimVy2a";

/**
 * NVDAx is the asset for all three demos: it has the deepest verified
 * tokenized-equity DLMM market with real turnover, a Raydium route the
 * router already uses, and a Pyth feed on both the underlying and the token.
 */
export const DEMO_EARN_STOCKS: EarnStocksConfig = {
  market: KAMINO.mainMarket,
  reserve: KAMINO.mainUsdcReserve,
  yieldAssetMint: USDC_MINT,
  yieldAssetDecimals: 6,
  targetStockMint: NVDAX_MINT,
  targetStockSymbol: "NVDAx",
  /** $5: below this a conversion costs more in fees than it accumulates. */
  minimumHarvestAmount: "5000000",
  minimumHarvestIntervalHours: 24,
  maximumConversionImpactBps: 100,
  /** $100 per conversion while this is a demo. */
  maximumConversionAmount: "100000000",
};

export const DEMO_SMART_ACCUMULATE: SmartAccumulateConfig = {
  pool: NVDAX_POOL,
  assetMint: NVDAX_MINT,
  assetSymbol: "NVDAx",
  quoteMint: USDC_MINT,
  quoteSymbol: "USDC",
  referenceSource: "pyth-fair-value",
  rangeStartBps: 200,
  rangeEndBps: 1_000,
  distribution: "DEEPER_DIP",
  levels: 5,
  /** $100 of demo capital, laddered. */
  capital: "100000000",
};

export const DEMO_RANGE_YIELD: RangeYieldConfig = {
  pool: NVDAX_POOL,
  assetMint: NVDAX_MINT,
  assetSymbol: "NVDAx",
  quoteMint: USDC_MINT,
  quoteSymbol: "USDC",
  referenceSource: "pyth-fair-value",
  rangeLowerBps: 500,
  rangeUpperBps: 500,
  distributionStrategy: "SPOT",
  /** Sized at deployment; zero until a position is actually funded. */
  baseCapital: "0",
  quoteCapital: "0",
  minimumFeeClaimAmount: "1000000",
};
