/**
 * Orca Whirlpools as a direct venue.
 *
 * Quotes: pool + tick arrays + Token-2022 context are read through the
 * official fetcher, then `swapQuoteWithParams` (pure) computes the swap; the
 * same fetched state backs `curve()` for the split optimizer. Builds:
 * `swapV2Ix` (Token-2022 aware) with the guard-approved floor as
 * `otherAmountThreshold`. No tick math is reimplemented.
 *
 * Fail-closed: no RPC → VENUE_NOT_CONFIGURED; registry/on-chain mint
 * disagreement → QUOTE_TERMS_MISMATCH; transfer-hook mints → refused by the
 * shared mint policy upstream; partial fill → INSUFFICIENT_LIQUIDITY.
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

export const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const QUOTE_TTL_MS = 15_000;

type Sdk = typeof import("@orca-so/whirlpools-sdk");
type Common = typeof import("@orca-so/common-sdk");
let sdkPromise: Promise<[Sdk, Common]> | null = null;
function sdk() {
  if (!sdkPromise) sdkPromise = Promise.all([import("@orca-so/whirlpools-sdk"), import("@orca-so/common-sdk")]);
  return sdkPromise;
}

const fetchers = new WeakMap<Connection, import("@orca-so/whirlpools-sdk").WhirlpoolAccountFetcherInterface>();
async function fetcherFor(connection: Connection) {
  const [m] = await sdk();
  let f = fetchers.get(connection);
  if (!f) {
    f = m.buildDefaultAccountFetcher(connection);
    fetchers.set(connection, f);
  }
  return f;
}

type PoolState = {
  address: PublicKey;
  data: import("@orca-so/whirlpools-sdk").WhirlpoolData;
  tickArrays: import("@orca-so/whirlpools-sdk").TickArray[];
  oracle: import("@orca-so/whirlpools-sdk").OracleData | null;
  tokenExt: import("@orca-so/whirlpools-sdk").TokenExtensionContextForPool;
  aToB: boolean;
  slot: number;
};

async function readPool(connection: Connection, poolAddress: string, inputMint: string): Promise<PoolState | null> {
  const [m] = await sdk();
  const fetcher = await fetcherFor(connection);
  const address = new PublicKey(poolAddress);
  const opts = { maxAge: 0 }; // always fresh
  const data = await fetcher.getPool(address, opts);
  if (!data) return null;
  const aToB = data.tokenMintA.toBase58() === inputMint;
  const program = new PublicKey(ORCA_WHIRLPOOL_PROGRAM);
  const [tickArrays, oracle, tokenExt, slot] = await Promise.all([
    m.SwapUtils.getTickArrays(data.tickCurrentIndex, data.tickSpacing, aToB, program, address, fetcher, opts),
    m.SwapUtils.getOracle(program, address, fetcher, opts),
    m.TokenExtensionUtil.buildTokenExtensionContextForPool(fetcher, data.tokenMintA, data.tokenMintB, opts),
    connection.getSlot("confirmed"),
  ]);
  return { address, data, tickArrays, oracle, tokenExt, aToB, slot };
}

function computeQuote(m: Sdk, common: Common, state: PoolState, amountIn: bigint, now: number) {
  return m.swapQuoteWithParams(
    {
      whirlpoolData: state.data,
      tokenAmount: new BN(amountIn.toString()),
      otherAmountThreshold: m.SwapUtils.getDefaultOtherAmountThreshold(true),
      sqrtPriceLimit: m.SwapUtils.getDefaultSqrtPriceLimit(state.aToB),
      aToB: state.aToB,
      amountSpecifiedIsInput: true,
      tickArrays: state.tickArrays,
      oracleData: state.oracle,
      tokenExtensionCtx: state.tokenExt,
      timestampInSeconds: new BN(Math.floor(now / 1000)),
    },
    common.Percentage.fromFraction(0, 100),
  );
}

/**
 * What an Orca SDK failure actually means.
 *
 * A whirlpool that cannot fill a size reports it by running out of initialised
 * tick arrays: "Swap input value traversed too many arrays. Out of bounds at
 * attempt to traverse tick index -11264." That is insufficient liquidity at
 * that size, and it says neither "liquidity" nor "amount", so it was being
 * recorded as SDK_ERROR. A benchmark then reads a thin pool as a broken
 * adapter: 14 of the Orca refusals at $50k were this message.
 */
export function classifyOrcaError(message: string): UnavailableReason {
  if (/timeout|abort/i.test(message)) return "VENUE_TIMEOUT";
  if (
    /liquidity|amount/i.test(message) ||
    /traversed too many arrays|out of bounds|tick ?array|tick index|TickArraySequence/i.test(message)
  )
    return "INSUFFICIENT_LIQUIDITY";
  return "SDK_ERROR";
}

function pickPool(pools: VerifiedPool[]) {
  const usable = pools.filter((p) => p.venue === "orca" && p.enabled && p.poolType === "whirlpool" && p.programId === ORCA_WHIRLPOOL_PROGRAM);
  usable.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return usable[0] ?? null;
}

export type OrcaAdapterOptions = { executionEnabled?: boolean };

export class OrcaAdapter implements VenueAdapter {
  readonly venue = "orca" as const;
  constructor(private readonly options: OrcaAdapterOptions = {}) {}

  private executionEnabled() {
    return this.options.executionEnabled ?? flagEnabled("routerExecution");
  }

  capabilities(): VenueCapabilities {
    return { venue: this.venue, quote: true, legacyExecution: false, nativeBuild: this.executionEnabled(), poolTypes: ["whirlpool"], supportsMinOut: true, supportsToken2022: true };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!ctx.connection) return { venue: this.venue, healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: this.venue, healthy: true, checkedAt, detail: null };
    } catch (error) {
      return { venue: this.venue, healthy: false, checkedAt, detail: (error as Error).message };
    }
  }

  private toQuote(m: Sdk, common: Common, request: QuoteRequest, pool: VerifiedPool, state: PoolState, amountIn: bigint, ctx: QuoteContext): VenueQuote {
    const q = computeQuote(m, common, state, amountIn, ctx.now);
    const inAmount = BigInt(q.estimatedAmountIn.toString());
    const out = BigInt(q.estimatedAmountOut.toString());
    const fee = BigInt(q.estimatedFeeAmount.toString());
    const partial = inAmount !== amountIn;
    // Impact from the pool's pre-trade sqrt price (Q64.64), integer math.
    const sqrt = BigInt(state.data.sqrtPrice.toString());
    const priceQ128 = sqrt * sqrt; // B per A
    const expected = state.aToB ? (amountIn * priceQ128) >> 128n : (amountIn << 128n) / priceQ128;
    const grossOut = out + (state.aToB ? 0n : 0n);
    const impact = expected > 0n && grossOut < expected ? Number(((expected - grossOut) * 10_000n) / expected) : 0;
    return {
      venue: this.venue,
      routeType: "DEX",
      representationId: request.representationId,
      poolAddress: pool.address,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amountIn: toRaw(inAmount),
      expectedAmountOut: toRaw(out),
      minimumAmountOut: null,
      effectivePrice: null,
      venueFeeBps: Math.round(state.data.feeRate / 100),
      venueFeeAmount: toRaw(fee),
      estimatedNetworkCostLamports: null,
      priceImpactBps: impact,
      slot: state.slot,
      quotedAt: new Date(ctx.now).toISOString(),
      expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
      source: "@orca-so/whirlpools-sdk swapQuoteWithParams",
      executionPath: this.executionEnabled() ? "henar-native" : "none",
      onchainCheckedAtQuote: true,
      unavailableReason: partial ? "INSUFFICIENT_LIQUIDITY" : out <= 0n ? "INSUFFICIENT_LIQUIDITY" : null,
      unavailableDetail: partial ? "pool cannot fill the full amount within loaded tick arrays" : out <= 0n ? "zero output" : null,
      rawRouteMetadata: {
        kind: "orca",
        tickSpacing: state.data.tickSpacing,
        tickCurrentIndex: state.data.tickCurrentIndex,
        endTickIndex: q.estimatedEndTickIndex,
        tickArrays: [q.tickArray0, q.tickArray1, q.tickArray2].map((k) => k.toBase58()),
        transferFeeIn: q.transferFee.deductingFromEstimatedAmountIn.toString(),
        transferFeeOut: q.transferFee.deductedFromEstimatedAmountOut.toString(),
      },
    };
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    const fail = (reason: UnavailableReason, detail: string | null, pool: string | null = null) => unavailableQuote(this.venue, request, reason, detail, pool, ctx.now);
    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) return fail("NO_VERIFIED_POOL", "no enabled Orca Whirlpool");
    if (!ctx.connection) return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);
    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint)) return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);
    try {
      const [m, common] = await sdk();
      const state = await readPool(ctx.connection, pool.address, request.inputMint);
      if (!state) return fail("NO_VERIFIED_POOL", "whirlpool account not found on chain", pool.address);
      const a = state.data.tokenMintA.toBase58();
      const b = state.data.tokenMintB.toBase58();
      if (!(pair.has(a) && pair.has(b))) return fail("QUOTE_TERMS_MISMATCH", "on-chain mints differ from registry pool", pool.address);
      return this.toQuote(m, common, request, pool, state, fromRaw(request.amount), ctx);
    } catch (error) {
      return fail(classifyOrcaError((error as Error).message), (error as Error).message, pool.address);
    }
  }

  async curve(request: QuoteRequest, pool: VerifiedPool, ctx: QuoteContext): Promise<VenueCurve | null> {
    if (!ctx.connection || pool.venue !== "orca" || !pool.enabled) return null;
    const [m, common] = await sdk();
    const state = await readPool(ctx.connection, pool.address, request.inputMint);
    if (!state) return null;
    const pair = new Set([state.data.tokenMintA.toBase58(), state.data.tokenMintB.toBase58()]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint)) return null;
    return {
      venue: "orca",
      poolAddress: pool.address,
      available: true,
      outputFor: (amountIn) => {
        if (amountIn <= 0n) return 0n;
        try {
          const q = computeQuote(m, common, state, amountIn, ctx.now);
          return BigInt(q.estimatedAmountIn.toString()) === amountIn ? BigInt(q.estimatedAmountOut.toString()) : null;
        } catch {
          return null;
        }
      },
      quoteFor: (amountIn) => this.toQuote(m, common, request, pool, state, amountIn, ctx),
    };
  }

  async buildSwapInstructions(quote: VenueQuote, ctx: QuoteContext, options?: BuildOptions): Promise<BuildResult> {
    const refuse = (reason: UnavailableReason, detail: string): BuildResult => ({ instructions: [], lookupTables: [], reason, detail });
    if (!this.executionEnabled()) return refuse("VENUE_DISABLED", "HENAR_ROUTER_EXECUTION is off");
    if (quote.venue !== this.venue || quote.unavailableReason || !quote.poolAddress) return refuse("INVALID_REQUEST", "quote is not an available Orca quote");
    if (!options) return refuse("INVALID_REQUEST", "owner and guard-approved minimumAmountOut are required");
    if (Date.parse(quote.expiresAt) < ctx.now) return refuse("QUOTE_EXPIRED", "quote expired");
    if (!ctx.connection) return refuse("VENUE_NOT_CONFIGURED", "no RPC connection");
    const minimumOut = fromRaw(options.minimumAmountOut);
    if (minimumOut <= 0n || minimumOut > fromRaw(quote.expectedAmountOut)) return refuse("INVALID_REQUEST", "minimumAmountOut must be positive and not above the quoted output");
    const pool = ctx.pools.find((p) => p.address === quote.poolAddress && p.venue === "orca" && p.enabled);
    if (!pool) return refuse("NO_VERIFIED_POOL", "quoted pool is not an enabled registry pool");
    try {
      const [m, common] = await sdk();
      const state = await readPool(ctx.connection, pool.address, quote.inputMint);
      if (!state) return refuse("NO_VERIFIED_POOL", "whirlpool account not found");
      const q = computeQuote(m, common, state, fromRaw(quote.amountIn), ctx.now);
      if (BigInt(q.estimatedAmountIn.toString()) !== fromRaw(quote.amountIn)) return refuse("INSUFFICIENT_LIQUIDITY", "pool can no longer fill the full amount");
      if (BigInt(q.estimatedAmountOut.toString()) < minimumOut) return refuse("SLIPPAGE_LIMIT_EXCEEDED", "state moved: current output is below the approved floor");
      const ctxSdk = m.WhirlpoolContext.from(ctx.connection, new common.ReadOnlyWallet(new PublicKey(options.owner)), await fetcherFor(ctx.connection), undefined, undefined, new PublicKey(ORCA_WHIRLPOOL_PROGRAM));
      const owner = new PublicKey(options.owner);
      const ext = state.tokenExt;
      // Transfer-hook mints are refused upstream by the shared mint policy
      // (registry verification + guard); no extra hook accounts are attached.
      const ataA = getAssociatedTokenAddressSync(state.data.tokenMintA, owner, true, ext.tokenMintWithProgramA.tokenProgram);
      const ataB = getAssociatedTokenAddressSync(state.data.tokenMintB, owner, true, ext.tokenMintWithProgramB.tokenProgram);
      const ix = m.WhirlpoolIx.swapV2Ix(ctxSdk.program, {
        amount: new BN(quote.amountIn),
        otherAmountThreshold: new BN(minimumOut.toString()),
        sqrtPriceLimit: q.sqrtPriceLimit,
        amountSpecifiedIsInput: true,
        aToB: state.aToB,
        tickArray0: q.tickArray0,
        tickArray1: q.tickArray1,
        tickArray2: q.tickArray2,
        supplementalTickArrays: q.supplementalTickArrays,
        whirlpool: state.address,
        tokenMintA: state.data.tokenMintA,
        tokenMintB: state.data.tokenMintB,
        tokenOwnerAccountA: ataA,
        tokenOwnerAccountB: ataB,
        tokenVaultA: state.data.tokenVaultA,
        tokenVaultB: state.data.tokenVaultB,
        tokenProgramA: ext.tokenMintWithProgramA.tokenProgram,
        tokenProgramB: ext.tokenMintWithProgramB.tokenProgram,
        oracle: m.PDAUtil.getOracle(new PublicKey(ORCA_WHIRLPOOL_PROGRAM), state.address).publicKey,
        tokenAuthority: owner,
      });
      if (ix.signers.length) return refuse("INVALID_REQUEST", "venue instructions require extra signers");
      const instructions: TransactionInstruction[] = [...ix.instructions, ...ix.cleanupInstructions];
      for (const i of instructions) for (const k of i.keys) if (k.isSigner && !k.pubkey.equals(owner)) return refuse("INVALID_REQUEST", `venue instruction requires signer ${k.pubkey.toBase58()}`);
      return { instructions, lookupTables: [], reason: null, detail: `swapV2Ix; otherAmountThreshold ${minimumOut}` };
    } catch (error) {
      return refuse("SDK_ERROR", (error as Error).message);
    }
  }
}

export const orcaAdapter = new OrcaAdapter();
