/**
 * Henar Equity Router — shared domain model.
 *
 * Every settlement-relevant amount is a `RawAmount`: a decimal string of
 * base units, converted to `bigint` in process. Floats never touch execution
 * amounts. Display formatting is a separate concern and lives with the UI.
 *
 * Every quote keeps provenance, and every rejection is a structured reason.
 * "Unavailable" is a valid product result; a dangerous fallback is not.
 */
import type {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Decimal string of base units. Never a float, never UI-scaled. */
export type RawAmount = string;

export type Side = "buy" | "sell";
export type AmountType = "input" | "output";
/**
 * Venue identifiers. Meteora has three distinct programs; they are three
 * venues here, never one. "meteora" is DLMM (kept for compatibility).
 */
export type Venue =
  | "jupiter"
  | "raydium"
  | "meteora"
  | "meteora-dbc"
  | "meteora-damm-v2"
  | "orca"
  | "titan"
  | "openocean"
  | "okx";

/**
 * Venues that are aggregators / RFQ networks rather than pools Henar holds
 * state for. They have no registry pool, no on-chain re-check at quote time,
 * and are benchmarked and routed to only when they beat Henar's own venues.
 */
export const AGGREGATOR_VENUES: ReadonlySet<Venue> = new Set<Venue>(["jupiter", "titan", "openocean", "okx"]);
export type Provider = "xstocks" | "backpack" | "ondo";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const U64_MAX = (1n << 64n) - 1n;

const RAW = /^\d{1,20}$/;

export function toRaw(value: bigint): RawAmount {
  if (value < 0n || value > U64_MAX) throw new Error("Amount outside u64.");
  return value.toString();
}

export function fromRaw(value: RawAmount): bigint {
  if (!RAW.test(value)) throw new Error("Malformed raw amount.");
  const parsed = BigInt(value);
  if (parsed > U64_MAX) throw new Error("Amount outside u64.");
  return parsed;
}

/** Basis points of an amount, rounded down. Explicit rounding direction. */
export function bpsOf(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000)
    throw new Error("Basis points out of range.");
  return (amount * BigInt(bps)) / 10_000n;
}

// ---------------------------------------------------------------------------
// Rejection reasons (plan §10, plus venue-level causes)
// ---------------------------------------------------------------------------

export type UnavailableReason =
  // registry / venue
  | "NO_VERIFIED_POOL"
  | "POOL_DISABLED"
  | "VENUE_NOT_CONFIGURED"
  | "VENUE_UNHEALTHY"
  | "VENUE_TIMEOUT"
  | "SDK_ERROR"
  | "QUOTE_TERMS_MISMATCH"
  // guard (Task 9) — declared now so adapters can already emit them
  | "INSUFFICIENT_LIQUIDITY"
  | "PRICE_IMPACT_TOO_HIGH"
  | "REFERENCE_PRICE_STALE"
  | "ROUTE_STATE_STALE"
  | "CORPORATE_ACTION_PENDING"
  | "SIMULATION_FAILED"
  | "QUOTE_EXPIRED"
  | "SLIPPAGE_LIMIT_EXCEEDED"
  | "REPRESENTATION_RESTRICTED"
  // venue-intrinsic fail-closed checks (DBC / DAMM v2)
  | "VENUE_DISABLED"
  | "POOL_INACTIVE"
  | "ROUTE_MIGRATING"
  | "POOL_GRADUATED"
  | "STALE_STATE"
  | "UNSUPPORTED_TOKEN_EXTENSION"
  | "NOT_ROUTER_ELIGIBLE"
  // engine
  | "ROUTER_DISABLED"
  | "INVALID_REQUEST"
  | "NOT_IMPLEMENTED";

// ---------------------------------------------------------------------------
// Registry views
// ---------------------------------------------------------------------------

export type PoolType =
  | "clmm" // Raydium Concentrated
  | "cpmm" // Raydium constant product v2
  | "amm_v4" // Raydium legacy
  | "dlmm" // Meteora DLMM (LBUZK…)
  | "dbc" // Meteora Dynamic Bonding Curve (dbcij…)
  | "damm_v2" // Meteora DAMM v2 / cp-amm (cpamd…) — DBC's graduation venue
  | "damm" // Meteora dynamic AMM v1 (legacy, no adapter)
  | "whirlpool"; // Orca

export type RepresentationStatus = "ACTIVE" | "RESTRICTED" | "PAUSED";

/** Token-2022 facts read on chain. `null` means not yet read — not "none". */
export type TokenExtensions = {
  scaledUiMultiplier: string | null;
  transferFeeBps: number | null;
  readAt: string;
};

/**
 * The router's view of a representation. Built from the canonical registry
 * (`src/lib/equities/registry.ts`); never extends it.
 */
export type RouterRepresentation = {
  id: string;
  equityId: string;
  provider: Provider;
  tokenSymbol: string;
  mint: string;
  decimals: number | null;
  tokenProgram: string | null;
  tokenExtensions: TokenExtensions | null;
  status: RepresentationStatus;
};

/**
 * How far a registry pool has been verified.
 *
 *  DISCOVERED          mints matched the catalogue exactly; venue metadata only.
 *  ONCHAIN_VERIFIED    mint accounts and pool program re-read from chain agree.
 *  VERIFICATION_FAILED chain disagreed with the registry; pool must stay disabled.
 *
 * Only the offline verification script may move a pool between states and
 * stamp `onchainVerifiedAt`. Adapters re-check the chain at quote time and
 * report that on the quote (`onchainCheckedAtQuote`); they never write here.
 */
export type DiscoverySource =
  | "RAYDIUM_API"
  | "RAYDIUM_ONCHAIN"
  | "ORCA_API"
  | "ORCA_ONCHAIN"
  | "METEORA_API"
  | "METEORA_ONCHAIN"
  | "JUPITER_FORENSICS";

/** Every source except forensics is authoritative for registry membership. */
export const VENUE_NATIVE_SOURCES: readonly DiscoverySource[] = [
  "RAYDIUM_API",
  "RAYDIUM_ONCHAIN",
  "ORCA_API",
  "ORCA_ONCHAIN",
  "METEORA_API",
  "METEORA_ONCHAIN",
];

export function venueNativeDiscovery(sources: DiscoverySource[] | undefined) {
  return (sources ?? []).some((source) => VENUE_NATIVE_SOURCES.includes(source));
}

export type PoolVerification =
  | "DISCOVERED"
  | "ONCHAIN_VERIFIED"
  | "VERIFICATION_FAILED";

/** A pool admitted to the verified registry (plan §5). */
export type VerifiedPool = {
  id: string;
  representationId: string;
  mint: string;
  provider: Provider;
  tokenSymbol: string;
  venue: Venue;
  address: string;
  programId: string;
  poolType: PoolType;
  baseMint: string;
  quoteMint: string;
  feeBps: number | null;
  feeConfig: {
    configId?: string;
    tickSpacing?: number;
    binStep?: number;
  } | null;
  /** From venue metadata, not from chain. Chain read sets onchainVerifiedAt. */
  observedTokenPrograms: { base: string | null; quote: string | null } | null;
  tvlUsd: number | null;
  discoveredFrom: string;
  /**
   * How this pool came to be known, deduplicated and retained across passes.
   *
   * Registry membership must not depend on what an aggregator happened to
   * route at build time: that makes coverage vary between deployments and
   * blinds Henar to every pool an RFQ path bypasses. A pool whose only
   * provenance is JUPITER_FORENSICS is therefore recorded and measured but
   * never enabled — `venueNativeDiscovery` is the gate.
   */
  discoverySources?: DiscoverySource[];
  discoveredAt: string;
  /** Matched exactly against Henar's catalogued mint universe. */
  verifiedAt: string;
  verification: PoolVerification;
  /** Set only when `verification` is ONCHAIN_VERIFIED. Never set by adapters. */
  onchainVerifiedAt: string | null;
  /** Why verification failed, or what the last chain read found. */
  verificationDetail: string | null;
  /**
   * ROUTER_ELIGIBLE: the pair is exactly {representation mint, USDC} and the
   * pool may enter the equity engine when `enabled`.
   * STOCK_PAIRED_INFRASTRUCTURE: a registry mint is one side but the market
   * is not a USDC↔equity route (e.g. NEW_TOKEN/NVDAx). Indexed, monitored,
   * lifecycle-tracked — never quoted by the equity engine. `enabled` must be
   * false for these; the engine only ever sees enabled pools.
   */
  eligibility: PoolEligibility;
  /** DBC-only lifecycle record. Null for every other pool type. */
  dbc: DbcRegistryRecord | null;
  enabled: boolean;
  disabledReason: string | null;
};

export type PoolEligibility = "ROUTER_ELIGIBLE" | "STOCK_PAIRED_INFRASTRUCTURE";

export function isOnchainVerified(pool: VerifiedPool) {
  return pool.verification === "ONCHAIN_VERIFIED" && pool.onchainVerifiedAt !== null;
}

// ---------------------------------------------------------------------------
// Meteora DBC lifecycle (registry side)
// ---------------------------------------------------------------------------

/**
 *  BONDING    curve active; may provide executable liquidity.
 *  MIGRATING  curve complete or migration in progress; fail closed.
 *  GRADUATED  migrated; the DAMM v2 successor is the live venue.
 *  PAUSED     not yet activated (activation point in the future).
 *  UNKNOWN    state could not be read or did not match any rule.
 */
export type DbcLifecycleState =
  | "BONDING"
  | "MIGRATING"
  | "GRADUATED"
  | "PAUSED"
  | "UNKNOWN";

export type DbcSuccessorStatus =
  | "NOT_APPLICABLE" // not graduated
  | "CONFIRMED" // DAMM v2 pool account read and mints matched
  | "UNRESOLVED"; // graduated but successor could not be verified

/**
 * What the registry remembers about a DBC pool. The DBC identity is kept
 * after graduation; the successor is linked, never substituted.
 */
export type DbcRegistryRecord = {
  configAddress: string;
  lifecycle: DbcLifecycleState;
  lifecycleCheckedAt: string | null;
  lifecycleSlot: number | null;
  successorStatus: DbcSuccessorStatus;
  /** `meteora-damm-v2` pool address once CONFIRMED. */
  successorPoolAddress: string | null;
  successorConfirmedAt: string | null;
};

// ---------------------------------------------------------------------------
// Token-2022 inspection (shared by every direct venue)
// ---------------------------------------------------------------------------

/**
 * What a mint account says about itself. Raw amounts are always base units
 * of the mint; `scaledUiMultiplier` is display-only and must never be used
 * to size a settlement quantity.
 */
export type MintInspection = {
  mint: string;
  program: string;
  decimals: number;
  isToken2022: boolean;
  extensions: string[];
  transferFeeBps: number | null;
  transferHookProgram: string | null;
  scaledUiMultiplier: string | null;
  permanentDelegate: string | null;
  nonTransferable: boolean;
  /** True only when every extension present is one the router can settle. */
  supported: boolean;
  unsupportedReason: string | null;
  readAt: string;
};

// ---------------------------------------------------------------------------
// Venue-specific quote metadata (kept out of the generic VenueQuote fields;
// carried in `rawRouteMetadata` with a discriminating `kind`).
// ---------------------------------------------------------------------------

export type DbcQuoteMetadata = {
  kind: "meteora-dbc";
  poolAddress: string;
  configAddress: string;
  lifecycleState: DbcLifecycleState;
  quoteReserve: RawAmount;
  baseReserve: RawAmount;
  migrationQuoteThreshold: RawAmount;
  /** quoteReserve / threshold in basis points (0–10000), integer. */
  graduationProgressBps: number;
  /** Quote per base in display units, from the SDK's sqrt-price helper. */
  currentPrice: string | null;
  currentFeeBps: number | null;
  baseFeeMode: "FeeSchedulerLinear" | "FeeSchedulerExponential" | "RateLimiter" | null;
  dynamicFeeEnabled: boolean;
  collectFeeMode: "QuoteToken" | "OutputToken" | null;
  activationType: "Slot" | "Timestamp" | null;
  activationPoint: string | null;
  currentPoint: string | null;
  migrationOption: "MET_DAMM" | "MET_DAMM_V2" | null;
  migrationFeeOption: number | null;
  expectedMigrationVenue: Venue | null;
  successorStatus: DbcSuccessorStatus;
  successorPoolAddress: string | null;
  baseMint: MintInspection | null;
  quoteMint: MintInspection | null;
  nextSqrtPrice: string | null;
  lastStateSlot: number | null;
  lastUpdatedAt: string;
};

export type DammV2QuoteMetadata = {
  kind: "meteora-damm-v2";
  poolAddress: string;
  poolStatus: "Enable" | "Disable" | null;
  activationType: "Slot" | "Timestamp" | null;
  activationPoint: string | null;
  currentPoint: string | null;
  sqrtPrice: string;
  sqrtMinPrice: string;
  sqrtMaxPrice: string;
  liquidity: string;
  tokenAAmount: RawAmount | null;
  tokenBAmount: RawAmount | null;
  collectFeeMode: "QuoteToken" | "OutputToken" | "Compounding" | null;
  feeVersion: number | null;
  dynamicFeeEnabled: boolean;
  currentFeeBps: number | null;
  tokenA: MintInspection | null;
  tokenB: MintInspection | null;
  nextSqrtPrice: string | null;
  lastStateSlot: number | null;
  lastUpdatedAt: string;
};

/** Caller-supplied inputs for building a swap; never stored on a quote. */
export type BuildOptions = {
  /** The user's wallet; the only signer any built transaction may require. */
  owner: string;
  /** Guard-approved floor (Task 9). Adapters refuse to build without it. */
  minimumAmountOut: RawAmount;
};

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type QuoteRequest = {
  representationId: string;
  side: Side;
  amount: RawAmount;
  amountType: AmountType;
  inputMint: string;
  outputMint: string;
  wallet?: string | null;
  /** Optional stricter user limit. System maximums still apply (Task 9). */
  maxSlippageBps?: number | null;
  requestedAt?: string;
};

export type VenueQuote = {
  venue: Venue;
  routeType: "DEX";
  representationId: string;
  poolAddress: string | null;
  inputMint: string;
  outputMint: string;
  amountIn: RawAmount;
  expectedAmountOut: RawAmount;
  minimumAmountOut: RawAmount | null;
  /** Output per input in display units, or null if decimals unknown. */
  effectivePrice: string | null;
  venueFeeBps: number | null;
  venueFeeAmount: RawAmount | null;
  estimatedNetworkCostLamports: RawAmount | null;
  priceImpactBps: number | null;
  slot: number | null;
  quotedAt: string;
  expiresAt: string;
  /** Where the numbers came from, e.g. "raydium-sdk-v2 computeAmountOutFormat". */
  source: string;
  /**
   * How this quote could reach a transaction today:
   *  "legacy-market-api"  the existing /api/market Jupiter build path;
   *  "henar-native"       the router's own builder (Task 14+, none yet);
   *  "none"               comparison only.
   * A quote path is not an execution path; the guard (Task 9) decides.
   */
  executionPath: ExecutionPath;
  /**
   * True when the adapter re-read the pool's mints and program from chain
   * for this quote and they matched the registry. This is a point-in-time
   * check and does not change the pool's registry `verification` state.
   */
  onchainCheckedAtQuote: boolean;
  unavailableReason: UnavailableReason | null;
  unavailableDetail: string | null;
  rawRouteMetadata: unknown;
};

export type ExecutionPath = "legacy-market-api" | "henar-native" | "none";

/**
 * Every amount on the way from the user's input to what the user keeps.
 * Exactly one of `henarInputFee` / `henarOutputFee` is non-zero, so the
 * fee cannot be charged on both sides. Invariants, checked in `rankQuote`:
 *   userInput        = venueInput + henarInputFee
 *   grossVenueOutput = netUserOutput + henarOutputFee
 * `venueFee` is informational: the venue has already taken it inside
 * `grossVenueOutput` (or on the input, per venue) and it is never deducted
 * again here.
 */
export type FeeBreakdown = {
  inputMint: string;
  outputMint: string;
  userInput: RawAmount;
  henarInputFee: RawAmount;
  venueInput: RawAmount;
  grossVenueOutput: RawAmount;
  venueFee: RawAmount | null;
  venueFeeMint: string | null;
  henarOutputFee: RawAmount;
  netUserOutput: RawAmount;
  henarFeeBps: number;
};

export type QuoteExclusion = {
  venue: Venue;
  poolAddress: string | null;
  reason: UnavailableReason;
  detail: string | null;
};

/** A venue quote with the Henar fee applied and net output computed. */
export type RankedQuote = VenueQuote & {
  fees: FeeBreakdown;
  henarFeeBps: number;
  henarFeeAmount: RawAmount;
  henarFeeMint: string;
  /** What the venue is actually asked to swap (input minus fee on buys). */
  swapInput: RawAmount;
  /** What the user keeps after every fee. Ranking key. */
  netOutput: RawAmount;
};

/**
 * A deterministic output curve for one pool on its current state, used by
 * the split optimizer (Task 12). Pure: no I/O inside `outputFor`.
 */
export type VenueCurve = {
  venue: Venue;
  poolAddress: string | null;
  /** Output for `amountIn`, or null when the venue cannot fill that amount. */
  outputFor(amountIn: bigint): bigint | null;
  /** False excludes the venue entirely (guard refusal, disabled, stale). */
  available: boolean;
  unavailableReason?: string | null;
  /** Build a full VenueQuote for one allocated leg from the same state. */
  quoteFor?: (amountIn: bigint) => VenueQuote;
};

/** A multi-leg route chosen by the split optimizer, ranked like a quote. */
export type RankedRoute = {
  kind: "single" | "split";
  legs: RankedQuote[];
  fees: FeeBreakdown;
  netOutput: RawAmount;
  improvementBps: number | null;
  penaltyBps: number;
  reason: string;
};

export type EngineResult = {
  enabled: boolean;
  request: QuoteRequest;
  best: RankedQuote | null;
  alternatives: RankedQuote[];
  /** Set only when split routing is on and a split beat the best single venue. */
  route: RankedRoute | null;
  exclusions: QuoteExclusion[];
  quotedAt: string;
  slot: number | null;
  latencyMs: Partial<Record<Venue, number>>;
};

export function unavailableQuote(
  venue: Venue,
  request: QuoteRequest,
  reason: UnavailableReason,
  detail: string | null = null,
  poolAddress: string | null = null,
  now = Date.now(),
): VenueQuote {
  const at = new Date(now).toISOString();
  return {
    venue,
    routeType: "DEX",
    representationId: request.representationId,
    poolAddress,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amountIn: request.amount,
    expectedAmountOut: "0",
    minimumAmountOut: null,
    effectivePrice: null,
    venueFeeBps: null,
    venueFeeAmount: null,
    estimatedNetworkCostLamports: null,
    priceImpactBps: null,
    slot: null,
    quotedAt: at,
    expiresAt: at,
    source: `${venue}:unavailable`,
    executionPath: "none",
    onchainCheckedAtQuote: false,
    unavailableReason: reason,
    unavailableDetail: detail,
    rawRouteMetadata: null,
  };
}

// ---------------------------------------------------------------------------
// Reference, session, policy (Tasks 9, 12)
// ---------------------------------------------------------------------------

export type MarketSession = {
  status: "open" | "closed" | "pre" | "post" | "unknown";
  exchange: string | null;
  asOf: string;
  nextOpen: string | null;
  nextClose: string | null;
};

export type ReferencePrice = {
  representationId: string;
  /** Display-unit price of the underlying, as a decimal string. */
  price: string;
  currency: "USD";
  source: string;
  asOf: string;
  confidence: number | null;
  /** "live" only during session with a fresh print; otherwise "close". */
  kind: "live" | "close";
  session: MarketSession;
};

/**
 * System-wide execution limits (Task 9). A user may tighten any limit for
 * their own trade; nothing may loosen one. Slippage is dynamic within
 * [`baseSlippageBps`, `maxSlippageBps`] as a function of quoted price
 * impact; it is never widened past `maxSlippageBps` or past the user's own
 * `maxSlippageBps` on the request.
 */
export type ExecutionPolicy = {
  /** Slippage applied to a quote with zero price impact. */
  baseSlippageBps: number;
  /** Extra slippage per basis point of price impact (e.g. 0.5). */
  slippagePerImpactBps: number;
  /** Absolute ceiling; a quote needing more is refused, not widened. */
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  maxQuoteAgeMs: number;
  /** Quote slot may trail the current slot by at most this many slots. */
  maxStateAgeSlots: number;
  /** Pools with unknown TVL fail this check unless the venue is Jupiter. */
  minLiquidityUsd: number;
  /** |venue price − reference| / reference, in bps. */
  maxReferenceDivergenceBps: number;
  /** Reference print older than this is stale. */
  maxReferenceAgeMs: number;
  /** When true, a reference price is mandatory and the session must be open. */
  requireReferencePrice: boolean;
  requireOpenSession: boolean;
  /** Execution requires the registry pool to be ONCHAIN_VERIFIED. */
  requireOnchainVerifiedPool: boolean;
  /** DBC: refuse execution this close to graduation (migration race). */
  dbcMaxGraduationProgressBps: number;
  maxLegs: number;
  minSplitImprovementBps: number;
};

// ---------------------------------------------------------------------------
// Routes and execution (Tasks 12–18)
// ---------------------------------------------------------------------------

export type RouteLeg = {
  venue: Venue;
  poolAddress: string;
  inputMint: string;
  outputMint: string;
  amountIn: RawAmount;
  expectedAmountOut: RawAmount;
  minimumAmountOut: RawAmount;
  percent: number;
};

export type Route = {
  representationId: string;
  legs: RouteLeg[];
  amountIn: RawAmount;
  expectedAmountOut: RawAmount;
  minimumAmountOut: RawAmount;
  henarFeeAmount: RawAmount;
  henarFeeMint: string;
  quotedAt: string;
  expiresAt: string;
  slot: number | null;
};

export type SplitRoute = Route & { improvementBps: number };

/** One venue hop inside a plan. Every leg carries its own on-chain floor. */
export type PlannedLeg = {
  index: number;
  venue: Venue;
  poolAddress: string;
  programId: string;
  inputMint: string;
  outputMint: string;
  inputTokenProgram: string;
  outputTokenProgram: string;
  amountIn: RawAmount;
  expectedAmountOut: RawAmount;
  /** Enforced by the venue instruction. Never null, never zero. */
  minimumAmountOut: RawAmount;
  percentBps: number;
  sourceSlot: number | null;
  quoteSource: string;
  /** Aggregator legs: every program the returned instructions invoke (filled at build). */
  programIds?: string[];
};

export type PlannedAta = {
  mint: string;
  owner: string;
  address: string;
  tokenProgram: string;
  purpose: "user-input" | "user-output" | "henar-fee";
};

/**
 * Venue-independent execution plan (Task 13). Describes everything a
 * transaction needs without serializing anything; the builder (Task 14)
 * consumes it, the simulator (Task 16) checks against it, and
 * reconciliation (Task 18) settles against it.
 */
export type ExecutionPlan = {
  planId: string;
  representationId: string;
  provider: Provider;
  side: Side;
  owner: string;
  legs: PlannedLeg[];
  totals: {
    amountIn: RawAmount;
    expectedAmountOut: RawAmount;
    /** Sum of leg floors: the aggregate the user is guaranteed on chain. */
    minimumAmountOut: RawAmount;
    /** After the Henar output fee on sells; equals minimumAmountOut on buys. */
    minimumNetUserOutput: RawAmount;
  };
  henarFee: {
    mint: string;
    amount: RawAmount;
    bps: number;
    on: "input" | "output";
    destination: string;
    destinationOwner: string;
    tokenProgram: string;
    decimals: number;
  };
  requiredAtas: PlannedAta[];
  requiredPrograms: string[];
  compute: { unitLimit: number; priorityFeeMicroLamports: number; estimatedUnits: number };
  /** Estimated distinct accounts across all instructions. */
  accountCount: number;
  lookupTables: { required: boolean; addresses: string[] };
  slippageBps: number;
  policy: ExecutionPolicy;
  quotedAt: string;
  expiresAt: string;
  sourceSlots: Partial<Record<Venue, number>>;
  createdAt: string;
};

export type TokenDelta = { mint: string; owner: string; account: string; before: RawAmount; after: RawAmount; delta: string };

export type SimulationResult = {
  ok: boolean;
  error: string | null;
  computeUnitsConsumed: number | null;
  logs: string[];
  tokenDeltas: TokenDelta[];
  /** Owner's output-mint delta vs the plan's expected/minimum output. */
  expectedOutput: RawAmount | null;
  simulatedOutput: RawAmount | null;
  minimumOutput: RawAmount | null;
  outputWithinPlan: boolean | null;
  slot: number | null;
  accountsChanged: string[];
  simulatedAt: string;
  /** False for fixture-normalized responses; true only for live RPC simulations. */
  live: boolean;
};

export type ExecutionStatus =
  | "QUOTED"
  | "BUILT"
  | "SIGNED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "UNKNOWN";

export type ExecutionResult = {
  planId: string;
  status: ExecutionStatus;
  signature: string | null;
  slot: number | null;
  amountIn: RawAmount | null;
  amountOut: RawAmount | null;
  henarFee: RawAmount | null;
  networkFeeLamports: RawAmount | null;
  route: { venue: Venue; poolAddress: string }[];
  failureReason: string | null;
  reconciledAt: string | null;
  /** True only when the status was derived from a confirmed chain transaction. */
  onchain: boolean;
};

// ---------------------------------------------------------------------------
// Adapter interfaces
// ---------------------------------------------------------------------------

export type VenueHealth = {
  venue: Venue;
  healthy: boolean;
  checkedAt: string;
  detail: string | null;
};

/**
 * Three capabilities that must not be conflated:
 *  quote             the adapter can price a swap;
 *  legacyExecution   a swap can be executed through the pre-router
 *                    /api/market path (Jupiter build + validateWalletRoute);
 *  nativeBuild       the router itself can build instructions for this
 *                    venue (`buildSwapInstructions`), Task 14+.
 */
export type VenueCapabilities = {
  venue: Venue;
  quote: boolean;
  legacyExecution: boolean;
  nativeBuild: boolean;
  poolTypes: PoolType[];
  supportsMinOut: boolean;
  supportsToken2022: boolean;
};

export type QuoteContext = {
  /** Null where no RPC is configured. Direct venues then fail closed. */
  connection: Connection | null;
  /** Enabled pools for the requested representation, all venues. */
  pools: VerifiedPool[];
  now: number;
  deadlineMs: number;
};

export type BuildResult = {
  instructions: TransactionInstruction[];
  lookupTables: PublicKey[];
  reason: UnavailableReason | null;
  detail: string | null;
  /** Aggregator venues: distinct programs the instructions invoke, for client validation. */
  programIds?: string[];
};

export interface VenueAdapter {
  readonly venue: Venue;
  capabilities(): VenueCapabilities;
  health(ctx: QuoteContext): Promise<VenueHealth>;
  getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote>;
  /**
   * Optional: fetch one pool's state once and return a pure output curve for
   * the split optimizer. Null when the pool cannot be curved right now.
   */
  curve?(request: QuoteRequest, pool: VerifiedPool, ctx: QuoteContext): Promise<VenueCurve | null>;
  /**
   * Prepare venue instructions for a quote. Adapters that can build require
   * `options` (owner + guard-approved minimum out) and are additionally gated
   * by their execution feature flag; without either they return a structured
   * reason and no instructions.
   */
  buildSwapInstructions(
    quote: VenueQuote,
    ctx: QuoteContext,
    options?: BuildOptions,
  ): Promise<BuildResult>;
}

// ---------------------------------------------------------------------------
// RFQ (plan §31) — interface only. Firm quotes are not AMM quotes.
// ---------------------------------------------------------------------------

export type RFQQuote = {
  maker: string;
  representationId: string;
  side: Side;
  amount: RawAmount;
  price: string;
  output: RawAmount;
  expiresAt: string;
  nonce: string;
  signature: string;
  settlementType: string;
};

export interface RFQVenueAdapter {
  readonly maker: string;
  requestFirmQuote(request: QuoteRequest): Promise<RFQQuote | null>;
}
