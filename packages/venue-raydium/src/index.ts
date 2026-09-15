/**
 * Raydium CLMM as a direct venue.
 *
 * Quotes come from the official SDK's `PoolUtils.computeAmountOutFormat`,
 * run against pool and tick-array state read from RPC. No CLMM math is
 * re-implemented here; the adapter's job is to feed the SDK verified inputs
 * and to translate its output into the router's domain model with the
 * amounts kept as raw integers.
 *
 * Fails closed:
 *  - no RPC in context → VENUE_NOT_CONFIGURED;
 *  - no enabled Raydium CLMM pool for the representation → NO_VERIFIED_POOL;
 *  - on-chain mints differ from the registry pool → QUOTE_TERMS_MISMATCH;
 *  - SDK reports the trade cannot be fully filled → INSUFFICIENT_LIQUIDITY.
 *
 * Token-2022 transfer fees: the SDK reports `realAmountIn`/`amountOut` with
 * any transfer fee already deducted. The router records those net figures,
 * since they are what the wallet will see.
 */
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import {
  flagEnabled,
  fromRaw,
  toRaw,
  unavailableQuote,
  type BuildOptions,
  type BuildResult,
  type QuoteContext,
  type QuoteRequest,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueHealth,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";

export const RAYDIUM_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const QUOTE_TTL_MS = 15_000;

type Sdk = typeof import("@raydium-io/raydium-sdk-v2");
let sdkPromise: Promise<Sdk> | null = null;
function sdk() {
  // Lazy: the SDK is heavy and only needed once a Raydium pool is quoted.
  if (!sdkPromise) sdkPromise = import("@raydium-io/raydium-sdk-v2");
  return sdkPromise;
}

const clients = new WeakMap<Connection, Promise<import("@raydium-io/raydium-sdk-v2").Raydium>>();
async function client(connection: Connection) {
  let existing = clients.get(connection);
  if (!existing) {
    existing = sdk().then((m) =>
      m.Raydium.load({
        connection,
        cluster: "mainnet",
        disableLoadToken: true,
        disableFeatureCheck: true,
      }),
    );
    clients.set(connection, existing);
  }
  return existing;
}

function bn(value: BN) {
  return BigInt(value.toString());
}

function pickPool(pools: VerifiedPool[]) {
  const usable = pools.filter(
    (p) => p.venue === "raydium" && p.enabled && p.poolType === "clmm" && p.programId === RAYDIUM_CLMM_PROGRAM,
  );
  // Deepest first. The engine may later fan out over every pool; today one
  // pool per venue keeps the quote cost to a single RPC batch.
  usable.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return usable[0] ?? null;
}

export type RaydiumAdapterOptions = {
  /** Override HENAR_ROUTER_EXECUTION (tests). */
  executionEnabled?: boolean;
};

export class RaydiumAdapter implements VenueAdapter {
  readonly venue = "raydium" as const;

  constructor(private readonly options: RaydiumAdapterOptions = {}) {}

  private executionEnabled() {
    return this.options.executionEnabled ?? flagEnabled("routerExecution");
  }

  capabilities(): VenueCapabilities {
    return {
      venue: "raydium",
      quote: true,
      legacyExecution: false,
      nativeBuild: this.executionEnabled(),
      poolTypes: ["clmm"],
      supportsMinOut: true,
      supportsToken2022: true,
    };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!ctx.connection)
      return { venue: "raydium", healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: "raydium", healthy: true, checkedAt, detail: null };
    } catch (error) {
      return {
        venue: "raydium",
        healthy: false,
        checkedAt,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    const fail = (
      reason: Parameters<typeof unavailableQuote>[2],
      detail: string | null,
      pool: string | null = null,
    ) => unavailableQuote("raydium", request, reason, detail, pool, ctx.now);

    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) return fail("NO_VERIFIED_POOL", "no enabled Raydium CLMM pool");
    if (!ctx.connection) return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);

    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint))
      return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);

    try {
      const m = await sdk();
      const raydium = await client(ctx.connection);
      const [state, epochInfo, slot] = await Promise.all([
        raydium.clmm.getPoolInfoFromRpc(pool.address),
        ctx.connection.getEpochInfo(),
        ctx.connection.getSlot("confirmed"),
      ]);
      const { computePoolInfo, tickData, poolInfo } = state;

      // The registry says which mints this pool holds; the chain must agree.
      const onchainA = computePoolInfo.mintA.address;
      const onchainB = computePoolInfo.mintB.address;
      if (!(new Set([onchainA, onchainB]).has(pool.baseMint) && new Set([onchainA, onchainB]).has(pool.quoteMint)))
        return fail("QUOTE_TERMS_MISMATCH", "on-chain mints differ from registry pool", pool.address);
      if (computePoolInfo.programId.toBase58() !== pool.programId)
        return fail("QUOTE_TERMS_MISMATCH", "on-chain program differs from registry pool", pool.address);

      const tokenOut = onchainA === request.outputMint ? computePoolInfo.mintA : computePoolInfo.mintB;
      const amountIn = new BN(request.amount);
      const blockTimestamp = Math.floor(ctx.now / 1000);

      const result = m.PoolUtils.computeAmountOutFormat({
        poolInfo: computePoolInfo,
        tickarrayBitmapExtension: computePoolInfo.exBitmapInfo,
        tickArrayCache: tickData[pool.address] ?? {},
        amountIn,
        tokenOut,
        slippage: 0,
        epochInfo,
        blockTimestamp,
        catchLiquidityInsufficient: true,
      });

      if (!result.allTrade)
        return fail("INSUFFICIENT_LIQUIDITY", "pool cannot fill the full amount", pool.address);

      const realIn = bn(result.realAmountIn.amount.raw);
      const out = bn(result.amountOut.amount.raw);
      const fee = bn(result.fee.raw);
      if (out <= 0n) return fail("INSUFFICIENT_LIQUIDITY", "zero output", pool.address);

      const impactBps = Math.round(Number(result.priceImpact.toFixed(6)) * 100);
      const feeBps = poolInfo.config?.tradeFeeRate !== undefined
        ? Math.round(poolInfo.config.tradeFeeRate / 100)
        : pool.feeBps;

      return {
        venue: "raydium",
        routeType: "DEX",
        representationId: request.representationId,
        poolAddress: pool.address,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amountIn: toRaw(realIn),
        expectedAmountOut: toRaw(out),
        // Slippage is applied by the router policy, not here (slippage: 0).
        minimumAmountOut: null,
        effectivePrice: result.executionPrice.toFixed(8),
        venueFeeBps: feeBps,
        venueFeeAmount: toRaw(fee),
        estimatedNetworkCostLamports: null,
        priceImpactBps: Number.isFinite(impactBps) ? impactBps : null,
        slot,
        quotedAt: new Date(ctx.now).toISOString(),
        expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
        source: "raydium-sdk-v2 PoolUtils.computeAmountOutFormat",
        // A native path exists only while HENAR_ROUTER_EXECUTION is on; the
        // guard still decides whether it may be used.
        executionPath: this.executionEnabled() ? "henar-native" : "none",
        // Mints and program were re-read from chain above and matched the
        // registry pool. Point-in-time only; the registry state is untouched.
        onchainCheckedAtQuote: true,
        unavailableReason: null,
        unavailableDetail: null,
        rawRouteMetadata: {
          tickSpacing: computePoolInfo.tickSpacing,
          tickCurrent: computePoolInfo.tickCurrent,
          liquidity: computePoolInfo.liquidity.toString(),
          remainingAccounts: result.remainingAccounts.map((k) => k.toBase58()),
          transferFeeIn: result.realAmountIn.fee ? result.realAmountIn.fee.raw.toString() : null,
          transferFeeOut: result.amountOut.fee ? result.amountOut.fee.raw.toString() : null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = /insufficient|liquidity/i.test(message)
        ? "INSUFFICIENT_LIQUIDITY"
        : /timeout|abort/i.test(message)
          ? "VENUE_TIMEOUT"
          : "SDK_ERROR";
      return fail(reason, message, pool.address);
    }
  }

  /**
   * Split-routing support: read this pool's state once and return a pure
   * curve over it. `outputFor` and `quoteFor` run `computeAmountOutFormat`
   * on the cached tick arrays — no I/O per evaluation.
   */
  async curve(request: QuoteRequest, pool: VerifiedPool, ctx: QuoteContext) {
    if (!ctx.connection || pool.venue !== "raydium" || !pool.enabled) return null;
    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint)) return null;
    const m = await sdk();
    const raydium = await client(ctx.connection);
    const [state, epochInfo, slot] = await Promise.all([
      raydium.clmm.getPoolInfoFromRpc(pool.address),
      ctx.connection.getEpochInfo(),
      ctx.connection.getSlot("confirmed"),
    ]);
    const { computePoolInfo, tickData, poolInfo } = state;
    const a = computePoolInfo.mintA.address;
    const b = computePoolInfo.mintB.address;
    if (!(pair.has(a) && pair.has(b))) return null;
    const tokenOut = a === request.outputMint ? computePoolInfo.mintA : computePoolInfo.mintB;
    const blockTimestamp = Math.floor(ctx.now / 1000);
    const feeBps = poolInfo.config?.tradeFeeRate !== undefined ? Math.round(poolInfo.config.tradeFeeRate / 100) : pool.feeBps;
    const compute = (amountIn: bigint) =>
      m.PoolUtils.computeAmountOutFormat({
        poolInfo: computePoolInfo,
        tickarrayBitmapExtension: computePoolInfo.exBitmapInfo,
        tickArrayCache: tickData[pool.address] ?? {},
        amountIn: new BN(amountIn.toString()),
        tokenOut,
        slippage: 0,
        epochInfo,
        blockTimestamp,
        catchLiquidityInsufficient: true,
      });
    const outputFor = (amountIn: bigint) => {
      if (amountIn <= 0n) return 0n;
      try {
        const r = compute(amountIn);
        return r.allTrade ? BigInt(r.amountOut.amount.raw.toString()) : null;
      } catch {
        return null;
      }
    };
    return {
      venue: "raydium" as const,
      poolAddress: pool.address,
      available: true,
      outputFor,
      quoteFor: (amountIn: bigint): VenueQuote => {
        const r = compute(amountIn);
        const out = BigInt(r.amountOut.amount.raw.toString());
        const impactBps = Math.round(Number(r.priceImpact.toFixed(6)) * 100);
        return {
          venue: "raydium",
          routeType: "DEX",
          representationId: request.representationId,
          poolAddress: pool.address,
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amountIn: toRaw(BigInt(r.realAmountIn.amount.raw.toString())),
          expectedAmountOut: toRaw(out),
          minimumAmountOut: null,
          effectivePrice: r.executionPrice.toFixed(8),
          venueFeeBps: feeBps,
          venueFeeAmount: toRaw(BigInt(r.fee.raw.toString())),
          estimatedNetworkCostLamports: null,
          priceImpactBps: Number.isFinite(impactBps) ? impactBps : null,
          slot,
          quotedAt: new Date(ctx.now).toISOString(),
          expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
          source: "raydium-sdk-v2 PoolUtils.computeAmountOutFormat (split leg)",
          executionPath: this.executionEnabled() ? "henar-native" : "none",
          onchainCheckedAtQuote: true,
          unavailableReason: r.allTrade ? null : "INSUFFICIENT_LIQUIDITY",
          unavailableDetail: r.allTrade ? null : "pool cannot fill the leg",
          rawRouteMetadata: { tickSpacing: computePoolInfo.tickSpacing, remainingAccounts: r.remainingAccounts.map((k) => k.toBase58()) },
        };
      },
    };
  }

  /**
   * Native CLMM swap instructions via the SDK's `ClmmInstrument.
   * makeSwapBaseInInstructions` (Task 14). State is re-read from RPC at
   * build time; the pool must still match the quote and the registry, and
   * the caller's guard-approved floor is passed as `amountOutMin`.
   */
  async buildSwapInstructions(quote: VenueQuote, ctx: QuoteContext, options?: BuildOptions): Promise<BuildResult> {
    const refuse = (reason: BuildResult["reason"], detail: string): BuildResult => ({ instructions: [], lookupTables: [], reason, detail });
    if (!this.executionEnabled()) return refuse("VENUE_DISABLED", "HENAR_ROUTER_EXECUTION is off");
    if (quote.venue !== this.venue || quote.unavailableReason || !quote.poolAddress) return refuse("INVALID_REQUEST", "quote is not an available Raydium quote");
    if (!options) return refuse("INVALID_REQUEST", "owner and guard-approved minimumAmountOut are required");
    if (Date.parse(quote.expiresAt) < ctx.now) return refuse("QUOTE_EXPIRED", "quote expired");
    if (!ctx.connection) return refuse("VENUE_NOT_CONFIGURED", "no RPC connection");
    const minimumOut = fromRaw(options.minimumAmountOut);
    if (minimumOut <= 0n || minimumOut > fromRaw(quote.expectedAmountOut)) return refuse("INVALID_REQUEST", "minimumAmountOut must be positive and not above the quoted output");
    const pool = ctx.pools.find((p) => p.address === quote.poolAddress && p.venue === "raydium" && p.enabled);
    if (!pool) return refuse("NO_VERIFIED_POOL", "quoted pool is not an enabled registry pool");
    try {
      const m = await sdk();
      const raydium = await client(ctx.connection);
      const [state, epochInfo] = await Promise.all([raydium.clmm.getPoolInfoFromRpc(pool.address), ctx.connection.getEpochInfo()]);
      const { computePoolInfo, poolKeys, poolInfo, tickData } = state;
      const a = computePoolInfo.mintA.address;
      const b = computePoolInfo.mintB.address;
      if (!(new Set([a, b]).has(quote.inputMint) && new Set([a, b]).has(quote.outputMint)))
        return refuse("QUOTE_TERMS_MISMATCH", "on-chain mints differ from the quote");
      const tokenOut = a === quote.outputMint ? computePoolInfo.mintA : computePoolInfo.mintB;
      // Re-run the SDK compute for the exact input to obtain the tick arrays
      // (remaining accounts) the swap will cross; the floor stays the guard's.
      const result = m.PoolUtils.computeAmountOutFormat({
        poolInfo: computePoolInfo,
        tickarrayBitmapExtension: computePoolInfo.exBitmapInfo,
        tickArrayCache: tickData[pool.address] ?? {},
        amountIn: new BN(quote.amountIn),
        tokenOut,
        slippage: 0,
        epochInfo,
        blockTimestamp: Math.floor(ctx.now / 1000),
        catchLiquidityInsufficient: true,
      });
      if (!result.allTrade) return refuse("INSUFFICIENT_LIQUIDITY", "pool can no longer fill the full amount");
      if (BigInt(result.amountOut.amount.raw.toString()) < minimumOut)
        return refuse("SLIPPAGE_LIMIT_EXCEEDED", "state moved: current output is below the approved floor");
      const owner = new PublicKey(options.owner);
      const ata = (mint: string, program: string) => getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, new PublicKey(program));
      const built = m.ClmmInstrument.makeSwapBaseInInstructions({
        poolInfo,
        poolKeys,
        observationId: computePoolInfo.observationId,
        ownerInfo: {
          wallet: owner,
          tokenAccountA: ata(a, computePoolInfo.mintA.programId),
          tokenAccountB: ata(b, computePoolInfo.mintB.programId),
        },
        inputMint: new PublicKey(quote.inputMint),
        amountIn: new BN(quote.amountIn),
        amountOutMin: new BN(minimumOut.toString()),
        sqrtPriceLimitX64: new BN(0),
        remainingAccounts: result.remainingAccounts,
      });
      if (built.signers.length) return refuse("INVALID_REQUEST", "venue instructions require extra signers");
      const instructions: TransactionInstruction[] = built.instructions;
      for (const ix of instructions)
        for (const k of ix.keys)
          if (k.isSigner && !k.pubkey.equals(owner)) return refuse("INVALID_REQUEST", `venue instruction requires signer ${k.pubkey.toBase58()}`);
      return {
        instructions,
        lookupTables: built.lookupTableAddress.map((t) => new PublicKey(t)),
        reason: null,
        detail: `ClmmInstrument.makeSwapBaseInInstructions; ${result.remainingAccounts.length} tick arrays; amountOutMin ${minimumOut}`,
      };
    } catch (error) {
      return refuse("SDK_ERROR", (error as Error).message);
    }
  }
}

export const raydiumAdapter = new RaydiumAdapter();
export * from "./native";
