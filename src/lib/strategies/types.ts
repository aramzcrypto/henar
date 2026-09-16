/**
 * Henar Earn strategy domain.
 *
 * A strategy is a definition (what it does, which protocols, what risk) plus
 * instances (a specific asset, market and position). Protocol specifics live
 * in adapters; nothing here knows about Kamino or Meteora.
 *
 * Every strategy in this version is funded by Henar's own demo capital.
 * Public deposits are not accepted, and the types make that state explicit
 * rather than leaving it to the UI.
 */
import type { DataProvenance } from "@/lib/provenance";

export const STRATEGY_TYPES = ["EARN_STOCKS", "SMART_ACCUMULATE", "RANGE_YIELD", "AUTO_COMPOUND_LP"] as const;
export type StrategyType = (typeof STRATEGY_TYPES)[number];

/**
 * Where a strategy is in its life.
 *  DESIGN             specified, not yet implemented end to end
 *  READY_FOR_DEMO     implemented and validated offline; no capital deployed
 *  LIVE_DEMO          Henar capital is deployed and the position is readable
 *  PAUSED             automation stopped, deliberately or by a breaker
 *  DEGRADED           running, but a data or protocol dependency is impaired
 *  CLOSED             position closed; kept for its history
 *  PRODUCTION_REVIEW  under review for public capital; still not accepting it
 */
export const STRATEGY_STATUSES = ["DESIGN", "READY_FOR_DEMO", "LIVE_DEMO", "PAUSED", "DEGRADED", "CLOSED", "PRODUCTION_REVIEW"] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

/** Who may put capital in. Nothing in this version is PRODUCTION. */
export const STRATEGY_ACCESS = ["PUBLIC_DEPOSITS_DISABLED", "INTERNAL_DEMO_ONLY", "PRODUCTION"] as const;
export type StrategyAccess = (typeof STRATEGY_ACCESS)[number];

export type AuditStatus = "NOT_AUDITED" | "INTERNAL_REVIEW" | "EXTERNAL_AUDIT";

export type RiskLevel = "MODERATE" | "HIGH" | "VERY_HIGH";

/**
 * Who can do what with a position's capital.
 *
 * These are read from the protocol, never assumed. An operator that can
 * withdraw principal is a custodial relationship whatever it is called, and
 * the adapter must say so here so the UI and the runner can act on it.
 */
export type AuthorityModel = {
  /** Holds the capital and its property rights. */
  owner: string;
  /** May take management actions. Null when the protocol has no such role. */
  operator: string | null;
  /** Receives claimed fees. Null when fees accrue to the owner. */
  feeOwner: string | null;
  /** Exactly what the operator may do, as verified against the protocol. */
  operatorCan: {
    addLiquidity: boolean;
    removeLiquidity: boolean;
    closePosition: boolean;
    claimFees: boolean;
    withdrawPrincipalToSelf: boolean;
  };
  /** How the above was established: SDK signature, IDL constraint, or docs. */
  verifiedBy: string;
  notes: string[];
};

export type FeeModel = {
  /** Charged on deposits. Henar charges none, now or planned. */
  depositFeeBps: number;
  /** Charged on withdrawals. Henar charges none, now or planned. */
  withdrawalFeeBps: number;
  /**
   * Share of realized strategy-generated yield or fees. Never charged on
   * principal, and never on unrealized gains. Zero during the preview.
   */
  performanceFeeBps: number;
  /** What the performance fee is assessed against when it is switched on. */
  performanceFeeBasis: "realized-yield" | "realized-lp-fees";
  /** True only when a fee is actually being taken. */
  active: boolean;
};

export type StrategyDefinition = {
  id: string;
  slug: string;
  name: string;
  /** One line, consumer-facing. */
  summary: string;
  /** What the depositor supplies, in plain words. */
  deposits: string;
  /** Where the return comes from, in plain words. */
  returnSource: string;
  strategyType: StrategyType;
  protocols: string[];
  supportedAssets: string[];
  supportedQuoteAssets: string[];
  riskLevel: RiskLevel;
  riskSummary: string;
  /** Risks a depositor would need to understand, each its own sentence. */
  risks: string[];
  operatorModel: string;
  feeModel: FeeModel;
  access: StrategyAccess;
  auditStatus: AuditStatus;
  status: StrategyStatus;
  /** Bumped whenever parameters or automation logic change. */
  version: string;
  docsUrl: string | null;
};

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

/** Exact integer base units, as the router uses. Never a float. */
export type RawAmount = string;

export type StrategyMarket = {
  /** Protocol pool or reserve address. */
  address: string;
  protocol: "kamino" | "meteora-dlmm";
  /** The stock side, absent for a cash-yield strategy. */
  assetMint: string | null;
  assetSymbol: string | null;
  representationId: string | null;
  quoteMint: string;
  quoteSymbol: string;
  /** Why this market passed the strategy registry's checks. */
  admittedBecause: string[];
  verifiedAt: string;
};

export type StrategyInstanceBase = {
  id: string;
  definitionId: string;
  strategyType: StrategyType;
  /** Display name, e.g. "Earn NVDA". */
  name: string;
  network: "solana";
  market: StrategyMarket;
  authority: AuthorityModel;
  /** Protocol position accounts this instance owns. */
  positionAddresses: string[];
  /** What Henar put in, in quote-asset base units. */
  deployedCapital: RawAmount | null;
  status: StrategyStatus;
  access: StrategyAccess;
  createdAt: string | null;
  lastUpdatedAt: string;
  /** Chain position the state was read at. */
  lastStateSlot: number | null;
  provenance: DataProvenance[];
  /** Set when a breaker or an operator paused it. */
  pausedReason: string | null;
};

/** Cash-yield: principal stays in USDC, only realized yield buys stock. */
export type EarnStocksState = {
  kind: "EARN_STOCKS";
  targetStockMint: string;
  targetStockSymbol: string;
  /** What was supplied, exactly. */
  principalDeposited: RawAmount;
  /** What the protocol says the position is worth now. */
  currentPrincipalClaim: RawAmount | null;
  /** currentPrincipalClaim − principalDeposited, floored at zero. */
  grossYieldAccrued: RawAmount | null;
  /** Yield withdrawn from the yield source and now held as USDC. */
  yieldRealized: RawAmount;
  /** Realized yield not yet converted to stock. */
  yieldPendingConversion: RawAmount;
  /** Realized yield that has been converted. */
  yieldConverted: RawAmount;
  /** Stock bought with yield, in the stock's base units. */
  stockAccumulated: RawAmount;
  /** Henar's share of realized yield. Zero while the fee is inactive. */
  strategyFees: RawAmount;
  /** yieldRealized − strategyFees. */
  netYield: RawAmount;
  currentSupplyApy: number | null;
  lastConversionAt: string | null;
  nextEligibleConversionAt: string | null;
  /** Why the last evaluation did not convert, when it did not. */
  conversionBlockedReason: string | null;
};

/** One rung of a Smart Accumulate ladder. */
export type AccumulationLevel = {
  index: number;
  /** USDC per whole stock unit, as a decimal string. */
  price: string;
  /** Allocated quote-asset base units. */
  allocated: RawAmount;
  /** DLMM bin this level maps to. */
  binId: number | null;
  /** Quote spent so far at this level. */
  filledQuote: RawAmount;
  /** Stock received so far at this level. */
  filledBase: RawAmount;
  status: "pending" | "partial" | "filled";
};

export type SmartAccumulateState = {
  kind: "SMART_ACCUMULATE";
  initialUSDC: RawAmount;
  remainingUSDC: RawAmount | null;
  stockAcquired: RawAmount | null;
  /** USDC per stock unit across everything filled. Null before the first fill. */
  averageAcquisitionPrice: string | null;
  /** Swap fees the position earned while filling, if the primitive earns any. */
  feesEarned: { base: RawAmount; quote: RawAmount } | null;
  referenceSource: "pyth-fair-value" | "executable-route";
  /** The reference the ladder was built from. */
  referencePrice: string | null;
  currentReference: string | null;
  rangeStart: string;
  rangeEnd: string;
  distribution: "EVEN" | "DEEPER_DIP";
  levels: AccumulationLevel[];
  levelsFilled: number;
  levelsRemaining: number;
  /**
   * Whether the protocol primitive can convert the acquired stock back into
   * USDC if price reverses. Read from the protocol, and stated plainly,
   * because the product promise depends on it.
   */
  reversible: boolean;
  reversibilityNote: string;
};

export type RangeYieldState = {
  kind: "RANGE_YIELD";
  lowerPrice: string;
  upperPrice: string;
  lowerBinId: number | null;
  upperBinId: number | null;
  activeBinId: number | null;
  currentPrice: string | null;
  pythFairValue: string | null;
  inRange: boolean | null;
  /** Current composition, in each token's base units. */
  baseAmount: RawAmount | null;
  quoteAmount: RawAmount | null;
  /** Share of position value in the stock, 0..1. */
  baseShare: number | null;
  positionValueQuote: RawAmount | null;
  feesUnclaimed: { base: RawAmount; quote: RawAmount } | null;
  feesClaimed: { base: RawAmount; quote: RawAmount };
  /**
   * Fee APR, only when the observation window justifies it. Null is the
   * normal state for a young position and must be shown as unavailable.
   */
  feeApr: { value: number; windowHours: number; source: string } | null;
  distribution: "SPOT" | "CURVE" | "BID_ASK";
};

export type StrategyState = EarnStocksState | SmartAccumulateState | RangeYieldState;

export type StrategyInstance = StrategyInstanceBase & { state: StrategyState };

// ---------------------------------------------------------------------------
// Actions and activity
// ---------------------------------------------------------------------------

export const STRATEGY_ACTIONS = ["HARVEST", "CONVERT_YIELD", "CLAIM_FEES", "REBALANCE", "PAUSE", "RESUME"] as const;
export type StrategyActionType = (typeof STRATEGY_ACTIONS)[number];

export type ActionOutcome = "EXECUTED" | "SKIPPED" | "FAILED" | "SIMULATED";

/** A proposed action, before any authorization or signing. */
export type ProposedAction = {
  strategyInstanceId: string;
  action: StrategyActionType;
  /** Amount the action would move, in the relevant token's base units. */
  amount: RawAmount | null;
  amountMint: string | null;
  reason: string;
  /** Every safety check the proposal was put through. */
  checks: ActionCheck[];
  proposedAt: string;
};

export type ActionCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

/** One recorded attempt, executed or not. Every field is observed, never assumed. */
export type ActivityEntry = {
  id: string;
  strategyInstanceId: string;
  action: StrategyActionType | "ACCRUAL" | "LEVEL_FILLED" | "STATUS_CHANGE";
  outcome: ActionOutcome;
  at: string;
  amounts: { mint: string; amount: RawAmount; label: string }[];
  reason: string | null;
  signature: string | null;
  slot: number | null;
  provenance: DataProvenance;
};
