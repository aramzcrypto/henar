/**
 * Meteora DAMM v2 (cp-amm) as a direct venue — the successor venue after a
 * DBC graduates, and a venue in its own right for any verified DAMM v2 pool.
 *
 * Not the DLMM adapter. DLMM (`LBUZK…`) and DAMM v2 (`cpamd…`) are different
 * programs with different state and different SDKs; a DAMM v2 pool routed
 * through the DLMM adapter would fail its program check and be excluded, but
 * the registry never assigns one to the other in the first place.
 *
 * Intrinsic fail-closed checks:
 *   no enabled pool / infra-only        NO_VERIFIED_POOL / NOT_ROUTER_ELIGIBLE
 *   wrong mints / program / flags       QUOTE_TERMS_MISMATCH
 *   pool_status Disable or not active   POOL_INACTIVE
 *   stale state                         STALE_STATE
 *   unsupported token extension         UNSUPPORTED_TOKEN_EXTENSION
 *   SDK cannot fill                     INSUFFICIENT_LIQUIDITY
 *   feature flag off                    VENUE_DISABLED
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
  type DammV2QuoteMetadata,
  type QuoteContext,
  type QuoteRequest,
  type UnavailableReason,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueHealth,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";
import { quoteDammV2ExactIn } from "./quote";
import {
  ACTIVATION_TYPES,
  COLLECT_FEE_MODES,
  METEORA_DAMM_V2_PROGRAM,
  POOL_STATUS,
  cpAmmClient,
  cpAmmSdk,
  dammV2Facts,
  enumLabel,
  readDammV2Pool,
  type DammV2MarketReader,
  type DammV2MarketState,
} from "./state";

export * from "./state";
export * from "./quote";
export * from "./native";

const QUOTE_TTL_MS = 10_000;
export const MAX_STATE_AGE_MS = 15_000;

export type MeteoraDammV2AdapterOptions = {
  quotesEnabled?: boolean;
  executionEnabled?: boolean;
  readMarket?: DammV2MarketReader;
  maxStateAgeMs?: number;
};

function pickPool(pools: VerifiedPool[]) {
  return (
    pools.find(
      (p) =>
        p.venue === "meteora-damm-v2" &&
        p.enabled &&
        p.poolType === "damm_v2" &&
        p.eligibility === "ROUTER_ELIGIBLE" &&
        p.programId === METEORA_DAMM_V2_PROGRAM,
    ) ?? null
  );
}

function currentFeeBps(m: Awaited<ReturnType<typeof cpAmmSdk>>, market: DammV2MarketState): number | null {
  try {
    const handler = m.getBaseFeeHandlerFromPodAlignedData(market.pool.poolFees.baseFee.baseFeeInfo.data);
    // Base fee at the current point for a nominal amount; rate limiters
    // (amount-dependent) resolve to their base tier at zero amount.
    const baseNumerator = handler.getBaseFeeNumeratorFromIncludedFeeAmount(
      new BN(market.currentPoint.toString()),
      market.pool.activationPoint,
      m.TradeDirection.BtoA,
      new BN(0),
      market.pool.poolFees.initSqrtPrice,
      market.pool.sqrtPrice,
    );
    const total = m.getTotalFeeNumerator(
      market.pool.poolFees,
      baseNumerator,
      m.getMaxFeeNumerator(Number(market.pool.feeVersion)),
    );
    return m.feeNumeratorToBps(total);
  } catch {
    return null;
  }
}

export function dammV2Metadata(
  m: Awaited<ReturnType<typeof cpAmmSdk>>,
  market: DammV2MarketState,
  nextSqrtPrice: bigint | null,
): DammV2QuoteMetadata {
  const facts = dammV2Facts(market.pool);
  return {
    kind: "meteora-damm-v2",
    poolAddress: market.poolAddress,
    poolStatus: enumLabel(POOL_STATUS, facts.poolStatus),
    activationType: enumLabel(ACTIVATION_TYPES, facts.activationType),
    activationPoint: facts.activationPoint.toString(),
    currentPoint: market.currentPoint.toString(),
    sqrtPrice: facts.sqrtPrice.toString(),
    sqrtMinPrice: facts.sqrtMinPrice.toString(),
    sqrtMaxPrice: facts.sqrtMaxPrice.toString(),
    liquidity: facts.liquidity.toString(),
    tokenAAmount: facts.tokenAAmount === null ? null : toRaw(facts.tokenAAmount),
    tokenBAmount: facts.tokenBAmount === null ? null : toRaw(facts.tokenBAmount),
    collectFeeMode: enumLabel(COLLECT_FEE_MODES, facts.collectFeeMode),
    feeVersion: facts.feeVersion,
    dynamicFeeEnabled: facts.dynamicFeeEnabled,
    currentFeeBps: currentFeeBps(m, market),
    tokenA: market.tokenA,
    tokenB: market.tokenB,
    nextSqrtPrice: nextSqrtPrice === null ? null : nextSqrtPrice.toString(),
    lastStateSlot: market.slot,
    lastUpdatedAt: market.readAt,
  };
}

export class MeteoraDammV2Adapter implements VenueAdapter {
  readonly venue = "meteora-damm-v2" as const;

  constructor(private readonly options: MeteoraDammV2AdapterOptions = {}) {}

  private quotesEnabled() {
    return this.options.quotesEnabled ?? flagEnabled("meteoraDammV2Quotes");
  }

  private executionEnabled() {
    return this.options.executionEnabled ?? flagEnabled("meteoraDammV2Execution");
  }

  capabilities(): VenueCapabilities {
    return {
      venue: this.venue,
      quote: true,
      legacyExecution: false,
      nativeBuild: this.executionEnabled(),
      poolTypes: ["damm_v2"],
      supportsMinOut: true,
      supportsToken2022: true,
    };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!this.quotesEnabled())
      return { venue: this.venue, healthy: false, checkedAt, detail: "HENAR_METEORA_DAMM_V2_QUOTES is off" };
    if (!ctx.connection) return { venue: this.venue, healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: this.venue, healthy: true, checkedAt, detail: null };
    } catch (error) {
      return { venue: this.venue, healthy: false, checkedAt, detail: (error as Error).message };
    }
  }

  private async market(connection: Connection | null, poolAddress: string) {
    if (this.options.readMarket) return this.options.readMarket(poolAddress);
    if (!connection) return null;
    return readDammV2Pool(connection, poolAddress);
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    const fail = (reason: UnavailableReason, detail: string | null, pool: string | null = null) =>
      unavailableQuote(this.venue, request, reason, detail, pool, ctx.now);

    if (!this.quotesEnabled()) return fail("VENUE_DISABLED", "HENAR_METEORA_DAMM_V2_QUOTES is off");
    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) {
      const infra = ctx.pools.find((p) => p.venue === "meteora-damm-v2" && p.eligibility !== "ROUTER_ELIGIBLE");
      return infra
        ? fail("NOT_ROUTER_ELIGIBLE", "stock-paired DAMM v2 market is not a USDC↔equity route", infra.address)
        : fail("NO_VERIFIED_POOL", "no enabled Meteora DAMM v2 pool");
    }
    if (!ctx.connection && !this.options.readMarket)
      return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);

    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint))
      return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);

    let market: DammV2MarketState | null;
    try {
      market = await this.market(ctx.connection, pool.address);
    } catch (error) {
      const message = (error as Error).message;
      return fail(/timeout|abort/i.test(message) ? "VENUE_TIMEOUT" : "SDK_ERROR", message, pool.address);
    }
    if (!market) return fail("NO_VERIFIED_POOL", "DAMM v2 pool account not found on chain", pool.address);

    const facts = dammV2Facts(market.pool);
    if (!(pair.has(facts.tokenAMint) && pair.has(facts.tokenBMint)))
      return fail("QUOTE_TERMS_MISMATCH", "on-chain mints differ from registry pool", pool.address);

    const ageMs = ctx.now - Date.parse(market.readAt);
    if (ageMs > (this.options.maxStateAgeMs ?? MAX_STATE_AGE_MS))
      return fail("STALE_STATE", `state is ${ageMs}ms old`, pool.address);

    for (const mint of [market.tokenA, market.tokenB]) {
      if (!mint) return fail("UNSUPPORTED_TOKEN_EXTENSION", "mint account could not be read", pool.address);
      if (!mint.supported)
        return fail("UNSUPPORTED_TOKEN_EXTENSION", `${mint.mint}: ${mint.unsupportedReason}`, pool.address);
    }
    // The pool's token flags must agree with the mint programs it names.
    if ((facts.tokenAFlag === 1) !== market.tokenA!.isToken2022 || (facts.tokenBFlag === 1) !== market.tokenB!.isToken2022)
      return fail("QUOTE_TERMS_MISMATCH", "pool token flags disagree with mint programs", pool.address);

    const m = await cpAmmSdk();
    const meta = (next: bigint | null) => dammV2Metadata(m, market!, next);
    const failWithMeta = (reason: UnavailableReason, detail: string) => ({
      ...fail(reason, detail, pool.address),
      rawRouteMetadata: meta(null),
    });
    if (!m.isSwapEnabled({ poolStatus: facts.poolStatus, activationPoint: market.pool.activationPoint }, new BN(market.currentPoint.toString())))
      return failWithMeta(
        "POOL_INACTIVE",
        facts.poolStatus !== 0 ? "pool_status Disable" : `not yet active: current_point ${market.currentPoint} < activation_point ${facts.activationPoint}`,
      );

    const aToB = request.inputMint === facts.tokenAMint;
    let computed;
    try {
      computed = quoteDammV2ExactIn(
        {
          pool: market.pool,
          aToB,
          amountIn: fromRaw(request.amount),
          currentPoint: market.currentPoint,
          tokenADecimals: market.tokenA!.decimals,
          tokenBDecimals: market.tokenB!.decimals,
        },
        m.swapQuoteExactInput,
      );
    } catch (error) {
      const message = (error as Error).message;
      if (/disabled/i.test(message)) return failWithMeta("POOL_INACTIVE", message);
      if (/insufficient|liquidity|zero/i.test(message)) return failWithMeta("INSUFFICIENT_LIQUIDITY", message);
      return failWithMeta("SDK_ERROR", message);
    }
    if (computed.amountLeft !== 0n || computed.includedFeeInputAmount !== fromRaw(request.amount))
      return failWithMeta("INSUFFICIENT_LIQUIDITY", "pool cannot fill the full amount");
    if (computed.outputAmount <= 0n) return failWithMeta("INSUFFICIENT_LIQUIDITY", "zero output");

    const venueFee = computed.claimingFee + computed.protocolFee + computed.compoundingFee + computed.referralFee;
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
      venueFeeBps: currentFeeBps(m, market),
      venueFeeAmount: toRaw(venueFee),
      estimatedNetworkCostLamports: null,
      priceImpactBps: computed.priceImpactBps,
      slot: market.slot,
      quotedAt: new Date(ctx.now).toISOString(),
      expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
      source: "@meteora-ag/cp-amm-sdk swapQuoteExactInput",
      executionPath: "none",
      onchainCheckedAtQuote: true,
      unavailableReason: null,
      unavailableDetail: null,
      rawRouteMetadata: meta(computed.nextSqrtPrice),
    };
  }

  async buildSwapInstructions(quote: VenueQuote, ctx: QuoteContext, options?: BuildOptions): Promise<BuildResult> {
    const refuse = (reason: UnavailableReason, detail: string): BuildResult => ({
      instructions: [],
      lookupTables: [],
      reason,
      detail,
    });
    if (!this.executionEnabled()) return refuse("VENUE_DISABLED", "HENAR_METEORA_DAMM_V2_EXECUTION is off");
    if (quote.venue !== this.venue || quote.unavailableReason || !quote.poolAddress)
      return refuse("INVALID_REQUEST", "quote is not an available DAMM v2 quote");
    if (!options) return refuse("INVALID_REQUEST", "owner and guard-approved minimumAmountOut are required");
    if (Date.parse(quote.expiresAt) < ctx.now) return refuse("QUOTE_EXPIRED", "quote expired");
    if (!ctx.connection) return refuse("VENUE_NOT_CONFIGURED", "no RPC connection");
    const meta = quote.rawRouteMetadata as DammV2QuoteMetadata | null;
    if (!meta || meta.kind !== "meteora-damm-v2" || !meta.tokenA || !meta.tokenB)
      return refuse("INVALID_REQUEST", "quote carries no DAMM v2 metadata");
    const minimumOut = fromRaw(options.minimumAmountOut);
    if (minimumOut <= 0n || minimumOut > fromRaw(quote.expectedAmountOut))
      return refuse("INVALID_REQUEST", "minimumAmountOut must be positive and not above the quoted output");

    try {
      const [m, client] = await Promise.all([cpAmmSdk(), cpAmmClient(ctx.connection)]);
      const owner = new PublicKey(options.owner);
      const poolAddress = new PublicKey(quote.poolAddress);
      const pool = await client.fetchPoolState(poolAddress);
      const tx = await client.swap2({
        payer: owner,
        pool: poolAddress,
        inputTokenMint: new PublicKey(quote.inputMint),
        outputTokenMint: new PublicKey(quote.outputMint),
        tokenAMint: pool.tokenAMint,
        tokenBMint: pool.tokenBMint,
        tokenAVault: pool.tokenAVault,
        tokenBVault: pool.tokenBVault,
        tokenAProgram: m.getTokenProgram(Number(pool.tokenAFlag)),
        tokenBProgram: m.getTokenProgram(Number(pool.tokenBFlag)),
        referralTokenAccount: null,
        poolState: pool,
        swapMode: m.SwapMode.ExactIn,
        amountIn: new BN(quote.amountIn),
        minimumAmountOut: new BN(minimumOut.toString()),
      });
      const instructions: TransactionInstruction[] = tx.instructions;
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

export const meteoraDammV2Adapter = new MeteoraDammV2Adapter();
