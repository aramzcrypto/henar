/**
 * Raydium CPMM (constant product, program CPMMoo8L…) as a direct venue.
 *
 * Shares the `raydium` venue id with the CLMM adapter; registry records are
 * told apart by `poolType: "cpmm"`. Quotes run the official SDK's
 * `CurveCalculator.swapBaseInput` over reserves read from RPC through
 * `raydium.cpmm.getPoolInfoFromRpc`. No AMM math is re-implemented; the
 * adapter feeds the SDK verified inputs and keeps every amount a raw integer.
 *
 * Fails closed, mirroring the CLMM adapter:
 *  - no enabled Raydium CPMM pool for the pair → NO_VERIFIED_POOL;
 *  - no RPC (and no injected reader) → VENUE_NOT_CONFIGURED;
 *  - on-chain mints/program differ from the registry → QUOTE_TERMS_MISMATCH;
 *  - swap disabled by pool status or not yet open → POOL_INACTIVE;
 *  - zero output or the input exceeds what the curve can fill → INSUFFICIENT_LIQUIDITY;
 *  - either mint carries a Token-2022 transfer fee → UNSUPPORTED_TOKEN_EXTENSION.
 *
 * Token-2022 transfer fees: the installed SDK (0.2.69-alpha) has no CPMM
 * transfer-fee handling — `cpmm.computeSwapAmount` and `cpmm.swap` pass the
 * gross amounts straight to the curve and the instruction — so a quote on a
 * fee-bearing mint would overstate the output. Rather than re-implement the
 * fee arithmetic here, the adapter refuses such pools.
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
  type UnavailableReason,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueCurve,
  type VenueHealth,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";

export const RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
const QUOTE_TTL_MS = 15_000;
/** Raydium fee rates are parts per million (2_500 = 0.25%); bps = rate / 100. */
const FEE_RATE_DENOMINATOR = 1_000_000n;
/** `PoolState.status` bit 2 set ⇒ swaps disabled (cp-swap `PoolStatusBitIndex::Swap`). */
const STATUS_SWAP_DISABLED_BIT = 1 << 2;

type Sdk = typeof import("@raydium-io/raydium-sdk-v2");
let sdkPromise: Promise<Sdk> | null = null;
function sdk() {
  if (!sdkPromise) sdkPromise = import("@raydium-io/raydium-sdk-v2");
  return sdkPromise;
}

const clients = new WeakMap<Connection, Promise<import("@raydium-io/raydium-sdk-v2").Raydium>>();
async function client(connection: Connection) {
  let existing = clients.get(connection);
  if (!existing) {
    existing = sdk().then((m) =>
      m.Raydium.load({ connection, cluster: "mainnet", disableLoadToken: true, disableFeatureCheck: true }),
    );
    clients.set(connection, existing);
  }
  return existing;
}

/**
 * The slice of `raydium.cpmm.getPoolInfoFromRpc` this adapter consumes.
 * Narrowed so tests can supply state without fabricating the SDK's API types.
 */
export type CpmmPoolState = {
  poolId: string;
  programId: string;
  mintA: CpmmMint;
  mintB: CpmmMint;
  vaultA: string;
  vaultB: string;
  authority: string;
  configId: string;
  observationId: string;
  /** Vault balances net of accrued protocol/fund/creator fees (the SDK's `baseReserve`/`quoteReserve`). */
  reserveA: bigint;
  reserveB: bigint;
  /** Parts-per-million rates from the pool's `AmmConfig`. */
  tradeFeeRate: bigint;
  creatorFeeRate: bigint;
  protocolFeeRate: bigint;
  fundFeeRate: bigint;
  enableCreatorFee: boolean;
  /** cp-swap `PoolState.fee_on`: 0/2 take the creator fee on the input side. */
  feeOn: number;
  status: number;
  openTime: bigint;
};

export type CpmmMint = {
  address: string;
  programId: string;
  decimals: number;
  /** True when the mint carries a Token-2022 transfer-fee config. */
  hasTransferFee: boolean;
};

export type CpmmPoolReader = (poolAddress: string) => Promise<CpmmPoolState>;

/** Map the SDK's `getPoolInfoFromRpc` result to the adapter's state slice. */
async function readPoolFromRpc(connection: Connection, poolAddress: string): Promise<CpmmPoolState> {
  const raydium = await client(connection);
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolAddress);
  const config = rpcData.configInfo;
  if (!config) throw new Error("SDK returned no AmmConfig for pool");
  const mint = (m: typeof poolInfo.mintA): CpmmMint => ({
    address: m.address,
    programId: m.programId,
    decimals: m.decimals,
    hasTransferFee: Boolean(m.extensions?.feeConfig),
  });
  return {
    poolId: poolAddress,
    programId: rpcData.programId.toBase58(),
    mintA: mint(poolInfo.mintA),
    mintB: mint(poolInfo.mintB),
    vaultA: poolKeys.vault.A,
    vaultB: poolKeys.vault.B,
    authority: poolKeys.authority,
    configId: poolKeys.config.id,
    observationId: poolKeys.observationId,
    reserveA: BigInt(rpcData.baseReserve.toString()),
    reserveB: BigInt(rpcData.quoteReserve.toString()),
    tradeFeeRate: BigInt(config.tradeFeeRate.toString()),
    creatorFeeRate: BigInt(config.creatorFeeRate.toString()),
    protocolFeeRate: BigInt(config.protocolFeeRate.toString()),
    fundFeeRate: BigInt(config.fundFeeRate.toString()),
    enableCreatorFee: rpcData.enableCreatorFee,
    feeOn: rpcData.feeOn,
    status: rpcData.status,
    openTime: BigInt(rpcData.openTime.toString()),
  };
}

function pickPool(pools: VerifiedPool[]) {
  const usable = pools.filter(
    (p) => p.venue === "raydium" && p.enabled && p.poolType === "cpmm" && p.programId === RAYDIUM_CPMM_PROGRAM,
  );
  usable.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return usable[0] ?? null;
}

type SwapMath = {
  amountOut: bigint;
  /** Trade fee plus creator fee: everything the pool keeps out of the trade. */
  fee: bigint;
  /** Input the curve actually consumed (equals the request for base-in). */
  amountIn: bigint;
};

/**
 * Run the SDK curve for `amountIn` of `inputMint` against `state`. Pure.
 * The creator fee is applied only when the pool has it enabled, as the
 * cp-swap program does; the config rate alone is not a commitment.
 */
function swapBaseIn(m: Sdk, state: CpmmPoolState, inputMint: string, amountIn: bigint): SwapMath {
  const inputIsA = inputMint === state.mintA.address;
  const inputReserve = inputIsA ? state.reserveA : state.reserveB;
  const outputReserve = inputIsA ? state.reserveB : state.reserveA;
  const creatorFeeOnInput = state.feeOn === 0 || state.feeOn === 2;
  const r = m.CurveCalculator.swapBaseInput(
    new BN(amountIn.toString()),
    new BN(inputReserve.toString()),
    new BN(outputReserve.toString()),
    new BN(state.tradeFeeRate.toString()),
    new BN((state.enableCreatorFee ? state.creatorFeeRate : 0n).toString()),
    new BN(state.protocolFeeRate.toString()),
    new BN(state.fundFeeRate.toString()),
    creatorFeeOnInput,
  );
  return {
    amountOut: BigInt(r.outputAmount.toString()),
    fee: BigInt(r.tradeFee.toString()) + BigInt(r.creatorFee.toString()),
    amountIn: BigInt(r.inputAmount.toString()),
  };
}

/**
 * Price impact in integer bps from spot vs execution price, in raw units:
 *   spot      = outputReserve / inputReserve
 *   execution = amountOut / amountIn
 *   impactBps = round((spot − execution) / spot × 10_000)
 *             = round((amountIn·outputReserve − amountOut·inputReserve) × 10_000 / (amountIn·outputReserve))
 * Fees are inside `amountOut`, so the figure includes the fee drag, as the
 * CLMM adapter's SDK-reported impact does.
 */
export function cpmmPriceImpactBps(amountIn: bigint, amountOut: bigint, inputReserve: bigint, outputReserve: bigint) {
  const denominator = amountIn * outputReserve;
  if (denominator <= 0n) return null;
  const numerator = (amountIn * outputReserve - amountOut * inputReserve) * 10_000n;
  // Round half away from zero on the integer division.
  const q = numerator / denominator;
  const r = numerator % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : r * 2n <= -denominator ? q - 1n : q;
  return Number(rounded);
}

function effectivePrice(amountIn: bigint, amountOut: bigint, decimalsIn: number, decimalsOut: number) {
  if (amountIn <= 0n) return null;
  const price = (Number(amountOut) / 10 ** decimalsOut) / (Number(amountIn) / 10 ** decimalsIn);
  return Number.isFinite(price) ? price.toFixed(8) : null;
}

function feeBpsOf(state: CpmmPoolState) {
  const rate = state.tradeFeeRate + (state.enableCreatorFee ? state.creatorFeeRate : 0n);
  return Number((rate * 10_000n) / FEE_RATE_DENOMINATOR);
}

export type RaydiumCpmmAdapterOptions = {
  /** Override HENAR_ROUTER_EXECUTION (tests). */
  executionEnabled?: boolean;
  /** Replace the chain reader (tests). Bypasses the RPC requirement. */
  readPool?: CpmmPoolReader;
};

export class RaydiumCpmmAdapter implements VenueAdapter {
  readonly venue = "raydium" as const;

  constructor(private readonly options: RaydiumCpmmAdapterOptions = {}) {}

  private executionEnabled() {
    return this.options.executionEnabled ?? flagEnabled("routerExecution");
  }

  capabilities(): VenueCapabilities {
    return {
      venue: "raydium",
      quote: true,
      legacyExecution: false,
      nativeBuild: this.executionEnabled(),
      poolTypes: ["cpmm"],
      supportsMinOut: true,
      // Token-2022 mints are fine; transfer-fee mints are refused (see header).
      supportsToken2022: true,
    };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!ctx.connection) return { venue: "raydium", healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: "raydium", healthy: true, checkedAt, detail: null };
    } catch (error) {
      return { venue: "raydium", healthy: false, checkedAt, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private readState(connection: Connection | null, poolAddress: string) {
    if (this.options.readPool) return this.options.readPool(poolAddress);
    if (!connection) throw new Error("no RPC connection");
    return readPoolFromRpc(connection, poolAddress);
  }

  /**
   * Registry-vs-chain checks shared by quote, curve and build. Returns the
   * refusal reason or null when the state may be quoted.
   */
  private verify(state: CpmmPoolState, pool: VerifiedPool, now: number): { reason: UnavailableReason; detail: string } | null {
    const onchain = new Set([state.mintA.address, state.mintB.address]);
    if (!(onchain.has(pool.baseMint) && onchain.has(pool.quoteMint)))
      return { reason: "QUOTE_TERMS_MISMATCH", detail: "on-chain mints differ from registry pool" };
    if (state.programId !== pool.programId)
      return { reason: "QUOTE_TERMS_MISMATCH", detail: "on-chain program differs from registry pool" };
    if (state.mintA.hasTransferFee || state.mintB.hasTransferFee)
      return { reason: "UNSUPPORTED_TOKEN_EXTENSION", detail: "transfer-fee mint; SDK has no CPMM transfer-fee handling" };
    if (state.status & STATUS_SWAP_DISABLED_BIT) return { reason: "POOL_INACTIVE", detail: "pool status disables swaps" };
    if (state.openTime > BigInt(Math.floor(now / 1000))) return { reason: "POOL_INACTIVE", detail: "pool not yet open" };
    if (state.reserveA <= 0n || state.reserveB <= 0n) return { reason: "INSUFFICIENT_LIQUIDITY", detail: "empty reserve" };
    return null;
  }

  private quoteFromState(
    m: Sdk,
    request: QuoteRequest,
    pool: VerifiedPool,
    state: CpmmPoolState,
    amountIn: bigint,
    slot: number | null,
    now: number,
    source: string,
  ): VenueQuote {
    const fail = (reason: UnavailableReason, detail: string) => unavailableQuote("raydium", request, reason, detail, pool.address, now);
    const inputIsA = request.inputMint === state.mintA.address;
    const inputReserve = inputIsA ? state.reserveA : state.reserveB;
    const outputReserve = inputIsA ? state.reserveB : state.reserveA;
    const mintIn = inputIsA ? state.mintA : state.mintB;
    const mintOut = inputIsA ? state.mintB : state.mintA;
    const r = swapBaseIn(m, state, request.inputMint, amountIn);
    if (r.amountOut <= 0n) return fail("INSUFFICIENT_LIQUIDITY", "zero output");
    if (r.amountOut >= outputReserve) return fail("INSUFFICIENT_LIQUIDITY", "output would drain the reserve");
    if (r.amountIn !== amountIn) return fail("INSUFFICIENT_LIQUIDITY", "curve did not consume the full input");
    const impactBps = cpmmPriceImpactBps(amountIn, r.amountOut, inputReserve, outputReserve);
    return {
      venue: "raydium",
      routeType: "DEX",
      representationId: request.representationId,
      poolAddress: pool.address,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amountIn: toRaw(amountIn),
      expectedAmountOut: toRaw(r.amountOut),
      // Slippage is applied by the router policy, not here.
      minimumAmountOut: null,
      effectivePrice: effectivePrice(amountIn, r.amountOut, mintIn.decimals, mintOut.decimals),
      venueFeeBps: feeBpsOf(state),
      venueFeeAmount: toRaw(r.fee),
      estimatedNetworkCostLamports: null,
      priceImpactBps: impactBps,
      slot,
      quotedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
      source,
      // A native path exists only while HENAR_ROUTER_EXECUTION is on; the
      // guard still decides whether it may be used.
      executionPath: this.executionEnabled() ? "henar-native" : "none",
      // Mints and program were re-read from chain (verify()) and matched the
      // registry pool. Point-in-time only; the registry state is untouched.
      onchainCheckedAtQuote: true,
      unavailableReason: null,
      unavailableDetail: null,
      rawRouteMetadata: {
        reserveIn: inputReserve.toString(),
        reserveOut: outputReserve.toString(),
        tradeFeeRate: state.tradeFeeRate.toString(),
        creatorFeeRate: state.enableCreatorFee ? state.creatorFeeRate.toString() : "0",
        feeOn: state.feeOn,
      },
    };
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    const fail = (reason: UnavailableReason, detail: string | null, pool: string | null = null) =>
      unavailableQuote("raydium", request, reason, detail, pool, ctx.now);

    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) return fail("NO_VERIFIED_POOL", "no enabled Raydium CPMM pool");
    if (!ctx.connection && !this.options.readPool) return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);

    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint) || request.inputMint === request.outputMint)
      return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);
    let amountIn: bigint;
    try {
      amountIn = fromRaw(request.amount);
    } catch {
      return fail("INVALID_REQUEST", "amount is not a raw integer", pool.address);
    }
    if (amountIn <= 0n) return fail("INVALID_REQUEST", "amount must be positive", pool.address);

    try {
      const [m, state, slot] = await Promise.all([
        sdk(),
        this.readState(ctx.connection, pool.address),
        ctx.connection ? ctx.connection.getSlot("confirmed") : Promise.resolve<number | null>(null),
      ]);
      const refusal = this.verify(state, pool, ctx.now);
      if (refusal) return fail(refusal.reason, refusal.detail, pool.address);
      return this.quoteFromState(m, request, pool, state, amountIn, slot, ctx.now, "raydium-sdk-v2 CurveCalculator.swapBaseInput");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason: UnavailableReason = /insufficient|liquidity/i.test(message)
        ? "INSUFFICIENT_LIQUIDITY"
        : /timeout|abort/i.test(message)
          ? "VENUE_TIMEOUT"
          : "SDK_ERROR";
      return fail(reason, message, pool.address);
    }
  }

  /**
   * Split-routing support: read the reserves once and return a pure curve
   * over them. `outputFor` and `quoteFor` run the SDK calculator on the
   * cached state — no I/O per evaluation.
   */
  async curve(request: QuoteRequest, pool: VerifiedPool, ctx: QuoteContext): Promise<VenueCurve | null> {
    if (pool.venue !== "raydium" || !pool.enabled || pool.poolType !== "cpmm") return null;
    if (!ctx.connection && !this.options.readPool) return null;
    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint)) return null;
    const [m, state, slot] = await Promise.all([
      sdk(),
      this.readState(ctx.connection, pool.address),
      ctx.connection ? ctx.connection.getSlot("confirmed") : Promise.resolve<number | null>(null),
    ]);
    if (this.verify(state, pool, ctx.now)) return null;
    const inputIsA = request.inputMint === state.mintA.address;
    const outputReserve = inputIsA ? state.reserveB : state.reserveA;
    const outputFor = (amountIn: bigint) => {
      if (amountIn <= 0n) return 0n;
      try {
        const r = swapBaseIn(m, state, request.inputMint, amountIn);
        return r.amountOut > 0n && r.amountOut < outputReserve && r.amountIn === amountIn ? r.amountOut : null;
      } catch {
        return null;
      }
    };
    return {
      venue: "raydium" as const,
      poolAddress: pool.address,
      available: true,
      outputFor,
      quoteFor: (amountIn: bigint) =>
        this.quoteFromState(m, request, pool, state, amountIn, slot, ctx.now, "raydium-sdk-v2 CurveCalculator.swapBaseInput (split leg)"),
    };
  }

  /**
   * Native CPMM swap instruction via the SDK's `makeSwapCpmmBaseInInstruction`.
   * State is re-read at build time; the pool must still match the quote and
   * the registry, the current output must still clear the guard-approved
   * floor, and that floor is what goes on chain as `amountOutMin`.
   */
  async buildSwapInstructions(quote: VenueQuote, ctx: QuoteContext, options?: BuildOptions): Promise<BuildResult> {
    const refuse = (reason: BuildResult["reason"], detail: string): BuildResult => ({ instructions: [], lookupTables: [], reason, detail });
    if (!this.executionEnabled()) return refuse("VENUE_DISABLED", "HENAR_ROUTER_EXECUTION is off");
    if (quote.venue !== this.venue || quote.unavailableReason || !quote.poolAddress) return refuse("INVALID_REQUEST", "quote is not an available Raydium quote");
    if (!options) return refuse("INVALID_REQUEST", "owner and guard-approved minimumAmountOut are required");
    if (Date.parse(quote.expiresAt) < ctx.now) return refuse("QUOTE_EXPIRED", "quote expired");
    if (!ctx.connection && !this.options.readPool) return refuse("VENUE_NOT_CONFIGURED", "no RPC connection");
    const minimumOut = fromRaw(options.minimumAmountOut);
    if (minimumOut <= 0n || minimumOut > fromRaw(quote.expectedAmountOut)) return refuse("INVALID_REQUEST", "minimumAmountOut must be positive and not above the quoted output");
    const pool = ctx.pools.find((p) => p.address === quote.poolAddress && p.venue === "raydium" && p.enabled && p.poolType === "cpmm");
    if (!pool) return refuse("NO_VERIFIED_POOL", "quoted pool is not an enabled registry CPMM pool");
    try {
      const [m, state] = await Promise.all([sdk(), this.readState(ctx.connection, pool.address)]);
      const refusal = this.verify(state, pool, ctx.now);
      if (refusal) return refuse(refusal.reason, refusal.detail);
      const onchain = new Set([state.mintA.address, state.mintB.address]);
      if (!(onchain.has(quote.inputMint) && onchain.has(quote.outputMint))) return refuse("QUOTE_TERMS_MISMATCH", "on-chain mints differ from the quote");
      const amountIn = fromRaw(quote.amountIn);
      const current = swapBaseIn(m, state, quote.inputMint, amountIn);
      if (current.amountOut <= 0n || current.amountOut >= (quote.inputMint === state.mintA.address ? state.reserveB : state.reserveA))
        return refuse("INSUFFICIENT_LIQUIDITY", "pool can no longer fill the full amount");
      if (current.amountOut < minimumOut) return refuse("SLIPPAGE_LIMIT_EXCEEDED", "state moved: current output is below the approved floor");

      const owner = new PublicKey(options.owner);
      const inputIsA = quote.inputMint === state.mintA.address;
      const mintIn = inputIsA ? state.mintA : state.mintB;
      const mintOut = inputIsA ? state.mintB : state.mintA;
      const ata = (mint: CpmmMint) => getAssociatedTokenAddressSync(new PublicKey(mint.address), owner, true, new PublicKey(mint.programId));
      const ix: TransactionInstruction = m.makeSwapCpmmBaseInInstruction(
        new PublicKey(state.programId),
        owner,
        new PublicKey(state.authority),
        new PublicKey(state.configId),
        new PublicKey(state.poolId),
        ata(mintIn),
        ata(mintOut),
        new PublicKey(inputIsA ? state.vaultA : state.vaultB),
        new PublicKey(inputIsA ? state.vaultB : state.vaultA),
        new PublicKey(mintIn.programId),
        new PublicKey(mintOut.programId),
        new PublicKey(mintIn.address),
        new PublicKey(mintOut.address),
        new PublicKey(state.observationId),
        new BN(amountIn.toString()),
        new BN(minimumOut.toString()),
      );
      for (const k of ix.keys)
        if (k.isSigner && !k.pubkey.equals(owner)) return refuse("INVALID_REQUEST", `venue instruction requires signer ${k.pubkey.toBase58()}`);
      return {
        instructions: [ix],
        lookupTables: [],
        reason: null,
        detail: `makeSwapCpmmBaseInInstruction; amountOutMin ${minimumOut}`,
      };
    } catch (error) {
      return refuse("SDK_ERROR", (error as Error).message);
    }
  }
}

export const raydiumCpmmAdapter = new RaydiumCpmmAdapter();
