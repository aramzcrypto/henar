/**
 * Meteora Dynamic Bonding Curve as a first-class venue.
 *
 * Plugs into the existing engine through `VenueAdapter`. The engine only
 * hands this adapter pools that are enabled — i.e. ROUTER_ELIGIBLE, BONDING
 * at last refresh — but every quote re-reads chain state and re-decides the
 * lifecycle, so a pool that graduated since the registry was built fails
 * closed here, not in production.
 *
 * Intrinsic fail-closed checks (Task 9 owns everything system-wide):
 *   unknown/unverified pool          NO_VERIFIED_POOL / NOT_ROUTER_ELIGIBLE
 *   wrong base/quote mint or program QUOTE_TERMS_MISMATCH
 *   not yet active                   POOL_INACTIVE
 *   curve complete / migrating       ROUTE_MIGRATING
 *   migrated                         POOL_GRADUATED
 *   stale state                      STALE_STATE
 *   unsupported token extension      UNSUPPORTED_TOKEN_EXTENSION
 *   SDK refuses / cannot fill        INSUFFICIENT_LIQUIDITY
 *   feature flag off                 VENUE_DISABLED
 */
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import {
  flagEnabled,
  fromRaw,
  toRaw,
  unavailableQuote,
  type BuildOptions,
  type BuildResult,
  type DbcQuoteMetadata,
  type MintInspection,
  type QuoteContext,
  type QuoteRequest,
  type UnavailableReason,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueHealth,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";
import { classifyDbcLifecycle } from "./lifecycle";
import { quoteDbcExactIn } from "./quote";
import {
  ACTIVATION_TYPES,
  BASE_FEE_MODES,
  COLLECT_FEE_MODES,
  METEORA_DBC_PROGRAM,
  MIGRATION_OPTIONS,
  dbcClient,
  dbcFacts,
  dbcSdk,
  enumLabel,
  graduationProgressBps,
  readDbcMarket,
  type DbcMarketReader,
  type DbcMarketState,
} from "./state";

export * from "./state";
export * from "./lifecycle";
export * from "./quote";
export * from "./successor";
export * from "./native";

const QUOTE_TTL_MS = 10_000;
/** State older than this at quote time is refused rather than reused. */
export const MAX_STATE_AGE_MS = 15_000;

export type MeteoraDbcAdapterOptions = {
  /** Override HENAR_METEORA_DBC_QUOTES (tests). */
  quotesEnabled?: boolean;
  /** Override HENAR_METEORA_DBC_EXECUTION (tests). */
  executionEnabled?: boolean;
  /** Replace the chain reader (tests, monitoring replay). */
  readMarket?: DbcMarketReader;
  maxStateAgeMs?: number;
};

function pickPool(pools: VerifiedPool[]) {
  return (
    pools.find(
      (p) =>
        p.venue === "meteora-dbc" &&
        p.enabled &&
        p.poolType === "dbc" &&
        p.eligibility === "ROUTER_ELIGIBLE" &&
        p.programId === METEORA_DBC_PROGRAM &&
        p.dbc !== null,
    ) ?? null
  );
}

function feeBpsNow(
  m: Awaited<ReturnType<typeof dbcSdk>>,
  market: DbcMarketState,
): number | null {
  try {
    const base = market.config.poolFees.baseFee;
    const baseNumerator = m.getBaseFeeNumerator(
      base.cliffFeeNumerator,
      Number(base.firstFactor),
      new BN(base.secondFactor.toString()),
      new BN(base.thirdFactor.toString()),
      Number(base.baseFeeMode),
      new BN(market.currentPoint.toString()),
      market.pool.poolState.activationPoint,
    );
    const total = m.getTotalFeeNumerator(
      baseNumerator,
      market.config.poolFees.dynamicFee,
      market.pool.poolState.volatilityTracker,
    );
    return m.feeNumeratorToBps(total);
  } catch {
    return null;
  }
}

export function dbcMetadata(
  m: Awaited<ReturnType<typeof dbcSdk>>,
  market: DbcMarketState,
  extras: { nextSqrtPrice: bigint | null; successorStatus: DbcQuoteMetadata["successorStatus"]; successorPoolAddress: string | null },
): DbcQuoteMetadata {
  const facts = dbcFacts(market.pool, market.config);
  const lifecycle = classifyDbcLifecycle(facts, market.currentPoint);
  let currentPrice: string | null = null;
  try {
    const quoteDecimals = market.quoteMint?.decimals ?? null;
    if (quoteDecimals !== null)
      currentPrice = m
        .getPriceFromSqrtPrice(market.pool.poolState.sqrtPrice, facts.tokenDecimal, quoteDecimals)
        .toFixed(12);
  } catch {
    currentPrice = null;
  }
  return {
    kind: "meteora-dbc",
    poolAddress: market.poolAddress,
    configAddress: market.configAddress,
    lifecycleState: lifecycle.state,
    quoteReserve: toRaw(facts.quoteReserve),
    baseReserve: toRaw(facts.baseReserve),
    migrationQuoteThreshold: toRaw(facts.migrationQuoteThreshold),
    graduationProgressBps: graduationProgressBps(facts),
    currentPrice,
    currentFeeBps: feeBpsNow(m, market),
    baseFeeMode: enumLabel(BASE_FEE_MODES, facts.baseFeeMode),
    dynamicFeeEnabled: facts.dynamicFeeEnabled,
    collectFeeMode: enumLabel(COLLECT_FEE_MODES, facts.collectFeeMode),
    activationType: enumLabel(ACTIVATION_TYPES, facts.activationType),
    activationPoint: facts.activationPoint.toString(),
    currentPoint: market.currentPoint.toString(),
    migrationOption: enumLabel(MIGRATION_OPTIONS, facts.migrationOption),
    migrationFeeOption: facts.migrationFeeOption,
    expectedMigrationVenue: facts.migrationOption === 1 ? "meteora-damm-v2" : null,
    successorStatus: extras.successorStatus,
    successorPoolAddress: extras.successorPoolAddress,
    baseMint: market.baseMint,
    quoteMint: market.quoteMint,
    nextSqrtPrice: extras.nextSqrtPrice === null ? null : extras.nextSqrtPrice.toString(),
    lastStateSlot: market.slot,
    lastUpdatedAt: market.readAt,
  };
}

export class MeteoraDbcAdapter implements VenueAdapter {
  readonly venue = "meteora-dbc" as const;

  constructor(private readonly options: MeteoraDbcAdapterOptions = {}) {}

  private quotesEnabled() {
    return this.options.quotesEnabled ?? flagEnabled("meteoraDbcQuotes");
  }

  private executionEnabled() {
    return this.options.executionEnabled ?? flagEnabled("meteoraDbcExecution");
  }

  capabilities(): VenueCapabilities {
    return {
      venue: "meteora-dbc",
      quote: true,
      legacyExecution: false,
      // The builder exists (`buildSwapInstructions`) but is flag-gated off.
      nativeBuild: this.executionEnabled(),
      poolTypes: ["dbc"],
      supportsMinOut: true,
      supportsToken2022: true,
    };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!this.quotesEnabled())
      return { venue: this.venue, healthy: false, checkedAt, detail: "HENAR_METEORA_DBC_QUOTES is off" };
    if (!ctx.connection) return { venue: this.venue, healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: this.venue, healthy: true, checkedAt, detail: null };
    } catch (error) {
      return { venue: this.venue, healthy: false, checkedAt, detail: (error as Error).message };
    }
  }

  /** Read state through the injected reader or RPC. */
  private async market(connection: Connection | null, poolAddress: string) {
    if (this.options.readMarket) return this.options.readMarket(poolAddress);
    if (!connection) return null;
    return readDbcMarket(connection, poolAddress);
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    const fail = (reason: UnavailableReason, detail: string | null, pool: string | null = null) =>
      unavailableQuote(this.venue, request, reason, detail, pool, ctx.now);

    if (!this.quotesEnabled()) return fail("VENUE_DISABLED", "HENAR_METEORA_DBC_QUOTES is off");
    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) {
      const infra = ctx.pools.find((p) => p.venue === "meteora-dbc" && p.eligibility !== "ROUTER_ELIGIBLE");
      return infra
        ? fail("NOT_ROUTER_ELIGIBLE", "stock-paired DBC market is not a USDC↔equity route", infra.address)
        : fail("NO_VERIFIED_POOL", "no enabled Meteora DBC pool");
    }
    if (!ctx.connection && !this.options.readMarket)
      return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);

    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint))
      return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);

    let market: DbcMarketState | null;
    try {
      market = await this.market(ctx.connection, pool.address);
    } catch (error) {
      const message = (error as Error).message;
      return fail(/timeout|abort/i.test(message) ? "VENUE_TIMEOUT" : "SDK_ERROR", message, pool.address);
    }
    if (!market) return fail("NO_VERIFIED_POOL", "DBC pool account not found on chain", pool.address);

    // Chain must agree with the registry on every identity.
    const facts = dbcFacts(market.pool, market.config);
    if (!(pair.has(facts.baseMint) && pair.has(facts.quoteMint)))
      return fail("QUOTE_TERMS_MISMATCH", "on-chain mints differ from registry pool", pool.address);
    if (market.configAddress !== pool.dbc!.configAddress)
      return fail("QUOTE_TERMS_MISMATCH", "on-chain config differs from registry record", pool.address);

    const ageMs = ctx.now - Date.parse(market.readAt);
    if (ageMs > (this.options.maxStateAgeMs ?? MAX_STATE_AGE_MS))
      return fail("STALE_STATE", `state is ${ageMs}ms old`, pool.address);

    for (const mint of [market.baseMint, market.quoteMint]) {
      if (!mint) return fail("UNSUPPORTED_TOKEN_EXTENSION", "mint account could not be read", pool.address);
      if (!mint.supported)
        return fail("UNSUPPORTED_TOKEN_EXTENSION", `${mint.mint}: ${mint.unsupportedReason}`, pool.address);
    }
    if ((facts.tokenType === 1) !== market.baseMint!.isToken2022)
      return fail("QUOTE_TERMS_MISMATCH", "config token_type disagrees with base mint program", pool.address);

    const lifecycle = classifyDbcLifecycle(facts, market.currentPoint);
    const m = await dbcSdk();
    const meta = (next: bigint | null) =>
      dbcMetadata(m, market!, {
        nextSqrtPrice: next,
        successorStatus: pool.dbc!.successorStatus,
        successorPoolAddress: pool.dbc!.successorPoolAddress,
      });
    const failWithMeta = (reason: UnavailableReason, detail: string) => ({
      ...fail(reason, detail, pool.address),
      rawRouteMetadata: meta(null),
    });
    switch (lifecycle.state) {
      case "GRADUATED":
        return failWithMeta("POOL_GRADUATED", lifecycle.detail);
      case "MIGRATING":
        return failWithMeta("ROUTE_MIGRATING", lifecycle.detail);
      case "PAUSED":
        return failWithMeta("POOL_INACTIVE", lifecycle.detail);
      case "UNKNOWN":
        return failWithMeta("POOL_INACTIVE", lifecycle.detail);
      case "BONDING":
        break;
    }

    const swapBaseForQuote = request.inputMint === facts.baseMint;
    let computed;
    try {
      computed = quoteDbcExactIn(
        {
          pool: market.pool,
          config: market.config,
          swapBaseForQuote,
          amountIn: fromRaw(request.amount),
          currentPoint: market.currentPoint,
        },
        m.swapQuoteExactIn,
      );
    } catch (error) {
      const message = (error as Error).message;
      if (/completed/i.test(message)) return failWithMeta("ROUTE_MIGRATING", message);
      if (/insufficient|liquidity/i.test(message)) return failWithMeta("INSUFFICIENT_LIQUIDITY", message);
      return failWithMeta("SDK_ERROR", message);
    }
    if (computed.amountLeft !== 0n || computed.includedFeeInputAmount !== fromRaw(request.amount))
      return failWithMeta("INSUFFICIENT_LIQUIDITY", "pool cannot fill the full amount");
    if (computed.outputAmount <= 0n) return failWithMeta("INSUFFICIENT_LIQUIDITY", "zero output");

    const venueFee = computed.tradingFee + computed.protocolFee + computed.referralFee;
    return {
      venue: this.venue,
      routeType: "DEX",
      representationId: request.representationId,
      poolAddress: pool.address,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amountIn: request.amount,
      expectedAmountOut: toRaw(computed.outputAmount),
      minimumAmountOut: null,
      effectivePrice: null,
      venueFeeBps: feeBpsNow(m, market),
      venueFeeAmount: toRaw(venueFee),
      estimatedNetworkCostLamports: null,
      priceImpactBps: computed.priceImpactBps,
      slot: market.slot,
      quotedAt: new Date(ctx.now).toISOString(),
      expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
      source: "@meteora-ag/dynamic-bonding-curve-sdk swapQuoteExactIn",
      executionPath: "none",
      onchainCheckedAtQuote: true,
      unavailableReason: null,
      unavailableDetail: null,
      rawRouteMetadata: meta(computed.nextSqrtPrice),
    };
  }

  /**
   * Prepare swap2 (ExactIn) instructions through the SDK. Gated by
   * HENAR_METEORA_DBC_EXECUTION and by the caller supplying the owner and a
   * guard-approved minimum out. The SDK builds a legacy Transaction; its
   * instructions are returned unsigned, nothing is sent.
   */
  async buildSwapInstructions(quote: VenueQuote, ctx: QuoteContext, options?: BuildOptions): Promise<BuildResult> {
    const refuse = (reason: UnavailableReason, detail: string): BuildResult => ({
      instructions: [],
      lookupTables: [],
      reason,
      detail,
    });
    if (!this.executionEnabled()) return refuse("VENUE_DISABLED", "HENAR_METEORA_DBC_EXECUTION is off");
    if (quote.venue !== this.venue || quote.unavailableReason || !quote.poolAddress)
      return refuse("INVALID_REQUEST", "quote is not an available DBC quote");
    if (!options) return refuse("INVALID_REQUEST", "owner and guard-approved minimumAmountOut are required");
    if (Date.parse(quote.expiresAt) < ctx.now) return refuse("QUOTE_EXPIRED", "quote expired");
    if (!ctx.connection) return refuse("VENUE_NOT_CONFIGURED", "no RPC connection");
    const meta = quote.rawRouteMetadata as DbcQuoteMetadata | null;
    if (!meta || meta.kind !== "meteora-dbc") return refuse("INVALID_REQUEST", "quote carries no DBC metadata");
    const minimumOut = fromRaw(options.minimumAmountOut);
    if (minimumOut <= 0n || minimumOut > fromRaw(quote.expectedAmountOut))
      return refuse("INVALID_REQUEST", "minimumAmountOut must be positive and not above the quoted output");

    try {
      const [m, client] = await Promise.all([dbcSdk(), dbcClient(ctx.connection)]);
      const owner = new PublicKey(options.owner);
      const swapBaseForQuote = meta.baseMint?.mint === quote.inputMint;
      const tx = await client.pool.swap2({
        owner,
        pool: new PublicKey(quote.poolAddress),
        swapBaseForQuote,
        referralTokenAccount: null,
        swapMode: m.SwapMode.ExactIn,
        amountIn: new BN(quote.amountIn),
        minimumAmountOut: new BN(minimumOut.toString()),
      });
      const instructions: TransactionInstruction[] = tx.instructions;
      // Only the user may be asked to sign.
      for (const ix of instructions)
        for (const key of ix.keys)
          if (key.isSigner && !key.pubkey.equals(owner))
            return refuse("INVALID_REQUEST", `venue instruction requires signer ${key.pubkey.toBase58()}`);
      return { instructions, lookupTables: [], reason: null, detail: "swap2 ExactIn via SDK; unsigned" };
    } catch (error) {
      return refuse("SDK_ERROR", (error as Error).message);
    }
  }
}

export const meteoraDbcAdapter = new MeteoraDbcAdapter();
export type { MintInspection };
