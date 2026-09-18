/**
 * Byreal CLMM — direct quoting and a pure curve for the split optimizer.
 *
 * Byreal is Bybit's Solana DEX. Its CLMM program is a Raydium-layout fork with
 * its own published SDK (`@byreal-io/byreal-clmm-sdk`), so nothing here
 * reimplements tick math: state is decoded with the SDK's own `PoolLayout` and
 * priced with `PoolUtils.getOutputAmountAndRemainAccounts`.
 *
 * Measured before it was written (`docs/router/VENUE_RECON_2026-09-18.md`):
 * 21 representation/USDC pools, 19 filling $1,000 and 13 filling $50,000. It
 * loses to Jupiter alone in every one of 47 comparisons and beats Henar's own
 * native venues in 7 — because Jupiter does not choose Byreal, it *combines*
 * it. So this exists to be raced and, more importantly, to be a third leg the
 * split optimizer can allocate to; `curve()` is the point of the adapter as
 * much as `getQuote()` is.
 *
 * Fail closed: no RPC → VENUE_NOT_CONFIGURED; registry/on-chain mint
 * disagreement → QUOTE_TERMS_MISMATCH; a partial fill → INSUFFICIENT_LIQUIDITY
 * rather than a smaller number presented as the answer.
 *
 * Execution is not implemented. The SDK builds swap instructions, but a venue
 * earns the right to build only after its quotes have been watched against
 * live fills, so `buildSwapInstructions` refuses and the route is compared and
 * guarded but settled elsewhere.
 */
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import {
  flagEnabled,
  fromRaw,
  inspectMints,
  toRaw,
  unavailableQuote,
  type BuildOptions,
  type BuildResult,
  type QuoteContext,
  type QuoteRequest,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueCurve,
  type VenueHealth,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";

export const BYREAL_CLMM_PROGRAM = "REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const QUOTE_TTL_MS = 15_000;

type Sdk = typeof import("@byreal-io/byreal-clmm-sdk");
let sdkPromise: Promise<Sdk> | null = null;
/* The package is ESM with a CommonJS fallback; the router runs under both
   Next's bundler and plain tsx, and the same fallback the Earn adapter needs
   applies here. */
function sdk(): Promise<Sdk> {
  if (!sdkPromise)
    sdkPromise = import("@byreal-io/byreal-clmm-sdk").catch(async () => {
      const { createRequire } = await import("node:module");
      return createRequire(import.meta.url)("@byreal-io/byreal-clmm-sdk") as Sdk;
    });
  return sdkPromise;
}

function pickPool(pools: VerifiedPool[]) {
  /* Deepest first. With split routing on, the engine hands one pool per call
     and this picks the only candidate; without it, depth is the right default. */
  return (
    pools
      .filter((p) => p.venue === "byreal" && p.enabled)
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0] ?? null
  );
}

/** Everything needed to price this pool, read once. */
type PoolState = {
  poolInfo: Parameters<Sdk["PoolUtils"]["getOutputAmountAndRemainAccounts"]>[0]["poolInfo"];
  exBitmapInfo: Parameters<Sdk["PoolUtils"]["getOutputAmountAndRemainAccounts"]>[0]["exBitmapInfo"];
  ammConfig: Parameters<Sdk["PoolUtils"]["getOutputAmountAndRemainAccounts"]>[0]["ammConfig"];
  tickArrayInfo: Parameters<Sdk["PoolUtils"]["getOutputAmountAndRemainAccounts"]>[0]["tickArrayInfo"];
  mintA: string;
  mintB: string;
  feeBps: number;
  slot: number;
};

async function readPool(connection: Connection, address: string): Promise<PoolState | null> {
  const m = await sdk();
  const id = new PublicKey(address);
  const [account, slot] = await Promise.all([
    connection.getAccountInfo(id, "confirmed"),
    connection.getSlot("confirmed"),
  ]);
  if (!account) return null;
  if (account.owner.toBase58() !== BYREAL_CLMM_PROGRAM) return null;
  const decoded = m.PoolLayout.decode(account.data);
  const currentPrice = (Number(decoded.sqrtPriceX64.toString()) / 2 ** 64) ** 2;
  /* The SDK bundles its own @solana/web3.js, so its Connection and PublicKey
     are structurally identical but nominally distinct types. One cast at the
     boundary is honest; threading a second web3.js through the router is not. */
  const sdkConnection = connection as unknown as Parameters<Sdk["getTickArrayInfo"]>[0]["connection"];
  const poolInfo = {
    ...decoded,
    id,
    poolId: id,
    programId: new PublicKey(BYREAL_CLMM_PROGRAM),
    currentPrice,
  } as unknown as PoolState["poolInfo"];
  const [configAccount, exBitmapInfo] = await Promise.all([
    connection.getAccountInfo(decoded.ammConfig, "confirmed"),
    m.getTickArrayBitmapExtension(new PublicKey(BYREAL_CLMM_PROGRAM), id, sdkConnection),
  ]);
  if (!configAccount) return null;
  const ammConfig = m.AmmConfigLayout.decode(configAccount.data);
  const tickArrayInfo = await m.getTickArrayInfo({ connection: sdkConnection, poolInfo, exBitmapInfo });
  return {
    poolInfo,
    exBitmapInfo,
    ammConfig,
    tickArrayInfo,
    mintA: decoded.mintA.toBase58(),
    mintB: decoded.mintB.toBase58(),
    feeBps: Math.round(Number(ammConfig.tradeFeeRate) / 100),
    slot,
  };
}

/**
 * One amount priced against already-read state. Pure and synchronous, which is
 * what lets the split optimizer try dozens of allocations off a single read.
 *
 * A partial fill returns null. The SDK reports `allTrade: false` and still
 * hands back the output for the part it could fill; presenting that as the
 * output for the amount asked would overstate the pool and hand the optimizer
 * a leg it cannot settle.
 */
function priceAgainst(m: Sdk, state: PoolState, inputMint: string, amountIn: bigint) {
  if (amountIn <= 0n) return null;
  try {
    const out = m.PoolUtils.getOutputAmountAndRemainAccounts({
      poolInfo: state.poolInfo,
      exBitmapInfo: state.exBitmapInfo,
      ammConfig: state.ammConfig,
      tickArrayInfo: state.tickArrayInfo,
      inputTokenMint: new PublicKey(inputMint) as unknown as Parameters<
        Sdk["PoolUtils"]["getOutputAmountAndRemainAccounts"]
      >[0]["inputTokenMint"],
      inputAmount: new BN(amountIn.toString()),
      catchLiquidityInsufficient: true,
    });
    if (!out.allTrade) return null;
    const amountOut = BigInt(out.expectedAmountOut.toString());
    if (amountOut <= 0n) return null;
    /* The tick arrays this fill crosses are the swap instruction's remaining
       accounts. Pricing and building must agree on them, so they come from
       the same call rather than being derived again. */
    return { amountOut, feeAmount: BigInt(out.feeAmount.toString()), remainingAccounts: out.remainingAccounts };
  } catch {
    return null;
  }
}

export type ByrealAdapterOptions = { executionEnabled?: boolean };

export class ByrealAdapter implements VenueAdapter {
  readonly venue = "byreal" as const;

  constructor(private readonly options: ByrealAdapterOptions = {}) {}

  private executionEnabled() {
    return this.options.executionEnabled ?? flagEnabled("routerExecution");
  }

  capabilities(): VenueCapabilities {
    return {
      venue: "byreal",
      quote: true,
      legacyExecution: false,
      /* A capability, not a switch: the builder exists. HENAR_ROUTER_EXECUTION
         decides whether a build is allowed, enforced in buildSwapInstructions. */
      nativeBuild: true,
      poolTypes: ["byreal_clmm"],
      supportsMinOut: true,
      supportsToken2022: true,
    };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!ctx.connection) return { venue: "byreal", healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: "byreal", healthy: true, checkedAt, detail: null };
    } catch (error) {
      return { venue: "byreal", healthy: false, checkedAt, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    const fail = (
      reason: Parameters<typeof unavailableQuote>[2],
      detail: string | null,
      pool: string | null = null,
    ) => unavailableQuote("byreal", request, reason, detail, pool, ctx.now);

    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) return fail("NO_VERIFIED_POOL", "no enabled Byreal pool");
    if (!ctx.connection) return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);

    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint))
      return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);

    try {
      const m = await sdk();
      const state = await readPool(ctx.connection, pool.address);
      if (!state) return fail("NO_VERIFIED_POOL", "pool account not found or not a Byreal pool", pool.address);
      if (!(pair.has(state.mintA) && pair.has(state.mintB)))
        return fail("QUOTE_TERMS_MISMATCH", "on-chain mints differ from registry pool", pool.address);

      const priced = priceAgainst(m, state, request.inputMint, fromRaw(request.amount));
      if (!priced) return fail("INSUFFICIENT_LIQUIDITY", "pool cannot fill the full amount", pool.address);

      return {
        venue: "byreal",
        routeType: "DEX",
        representationId: request.representationId,
        poolAddress: pool.address,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amountIn: request.amount,
        expectedAmountOut: toRaw(priced.amountOut),
        minimumAmountOut: null,
        effectivePrice: null,
        venueFeeBps: state.feeBps,
        venueFeeAmount: toRaw(priced.feeAmount),
        estimatedNetworkCostLamports: null,
        priceImpactBps: null,
        slot: state.slot,
        quotedAt: new Date(ctx.now).toISOString(),
        expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
        source: "@byreal-io/byreal-clmm-sdk getOutputAmountAndRemainAccounts",
        executionPath: "none",
        // Mints and owning program were re-read from chain above.
        onchainCheckedAtQuote: true,
        unavailableReason: null,
        unavailableDetail: null,
        rawRouteMetadata: {
          program: BYREAL_CLMM_PROGRAM,
          quoteIsUsdc: state.mintB === USDC,
          feeBps: state.feeBps,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(/timeout|abort/i.test(message) ? "VENUE_TIMEOUT" : "SDK_ERROR", message, pool.address);
    }
  }

  /**
   * A pure output curve over one Byreal pool.
   *
   * This is the adapter's main contribution. Byreal wins outright on a
   * minority of trades, but Jupiter's own winning routes combine it with
   * Raydium and others, so the value is in being allocatable. State is read
   * once and every allocation the optimizer tries is priced off that read.
   */
  async curve(request: QuoteRequest, pool: VerifiedPool, ctx: QuoteContext): Promise<VenueCurve | null> {
    if (!ctx.connection || pool.venue !== "byreal" || !pool.enabled) return null;
    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint)) return null;
    try {
      const m = await sdk();
      const state = await readPool(ctx.connection, pool.address);
      if (!state) return null;
      if (!(pair.has(state.mintA) && pair.has(state.mintB))) return null;

      return {
        venue: "byreal",
        poolAddress: pool.address,
        available: true,
        outputFor: (amountIn) => {
          if (amountIn <= 0n) return 0n;
          const priced = priceAgainst(m, state, request.inputMint, amountIn);
          return priced ? priced.amountOut : null;
        },
        quoteFor: (amountIn) => {
          const priced = priceAgainst(m, state, request.inputMint, amountIn);
          if (!priced) throw new Error(`byreal cannot fill ${amountIn} on ${pool.address}`);
          return {
            venue: "byreal",
            routeType: "DEX",
            representationId: request.representationId,
            poolAddress: pool.address,
            inputMint: request.inputMint,
            outputMint: request.outputMint,
            amountIn: toRaw(amountIn),
            expectedAmountOut: toRaw(priced.amountOut),
            minimumAmountOut: null,
            effectivePrice: null,
            venueFeeBps: state.feeBps,
            venueFeeAmount: toRaw(priced.feeAmount),
            estimatedNetworkCostLamports: null,
            priceImpactBps: null,
            slot: state.slot,
            quotedAt: new Date(ctx.now).toISOString(),
            expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
            source: "@byreal-io/byreal-clmm-sdk getOutputAmountAndRemainAccounts",
            executionPath: "none",
            onchainCheckedAtQuote: true,
            unavailableReason: null,
            unavailableDetail: null,
            rawRouteMetadata: { program: BYREAL_CLMM_PROGRAM, feeBps: state.feeBps },
          };
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Native Byreal CLMM swap instructions.
   *
   * Built with the SDK's own `swapBaseInInstruction`, which wraps the
   * program's `swapV2` — the Token-2022-aware entry point that takes both
   * vault mints. No instruction layout is guessed here.
   *
   * Token-2022 is supported only as far as `swapV2` supports it: transfer
   * fees are handled by the program, transfer *hooks* need extra accounts
   * this instruction does not carry. A hooked mint is refused rather than
   * built, because the alternative is a transaction that fails on chain after
   * the user has signed it.
   */
  async buildSwapInstructions(quote: VenueQuote, ctx: QuoteContext, options?: BuildOptions): Promise<BuildResult> {
    const refuse = (reason: BuildResult["reason"], detail: string): BuildResult => ({ instructions: [], lookupTables: [], reason, detail });
    if (!this.executionEnabled()) return refuse("VENUE_DISABLED", "HENAR_ROUTER_EXECUTION is off");
    if (quote.venue !== this.venue || quote.unavailableReason || !quote.poolAddress)
      return refuse("INVALID_REQUEST", "quote is not an available Byreal quote");
    if (!options) return refuse("INVALID_REQUEST", "owner and guard-approved minimumAmountOut are required");
    if (Date.parse(quote.expiresAt) < ctx.now) return refuse("QUOTE_EXPIRED", "quote expired");
    if (!ctx.connection) return refuse("VENUE_NOT_CONFIGURED", "no RPC connection");
    const minimumOut = BigInt(options.minimumAmountOut);
    if (minimumOut <= 0n || minimumOut > BigInt(quote.expectedAmountOut))
      return refuse("INVALID_REQUEST", "minimumAmountOut must be positive and not above the quoted output");
    const pool = ctx.pools.find((p) => p.address === quote.poolAddress && p.venue === "byreal" && p.enabled);
    if (!pool) return refuse("NO_VERIFIED_POOL", "quoted pool is not an enabled registry pool");

    try {
      const m = await sdk();
      const connection: Connection = ctx.connection;
      const state = await readPool(connection, pool.address);
      if (!state) return refuse("SDK_ERROR", "pool state could not be read");
      const pair = new Set([state.mintA, state.mintB]);
      if (!(pair.has(quote.inputMint) && pair.has(quote.outputMint)))
        return refuse("QUOTE_TERMS_MISMATCH", "on-chain mints differ from the quote");

      /* Transfer hooks would need remaining accounts swapV2 does not carry.
         Fail closed: a hooked mint is refused, never built optimistically. */
      const mints = [state.mintA, state.mintB];
      const inspected = await inspectMints(connection, mints);
      const inspections = new Map(mints.map((mint, i) => [mint, inspected[i]]));
      for (const mint of mints) {
        const inspection = inspections.get(mint);
        if (!inspection) return refuse("SDK_ERROR", `mint ${mint} could not be inspected`);
        if (!inspection.supported)
          return refuse("REPRESENTATION_RESTRICTED", `mint ${mint}: ${inspection.unsupportedReason ?? "unsupported token extensions"}`);
        if (inspection.transferHookProgram)
          return refuse("REPRESENTATION_RESTRICTED", `mint ${mint} has a transfer hook; swapV2 carries no accounts for it`);
      }

      /* Re-price against current state before building: the guard approved a
         floor against the quoted output, and ticks move. */
      const fresh = priceAgainst(m, state, quote.inputMint, BigInt(quote.amountIn));
      if (!fresh) return refuse("INSUFFICIENT_LIQUIDITY", "pool can no longer fill the full amount");
      if (fresh.amountOut < minimumOut)
        return refuse("SLIPPAGE_LIMIT_EXCEEDED", "state moved: current output is below the approved floor");

      const owner = new PublicKey(options.owner);
      const programOf = (mint: string) => new PublicKey(inspections.get(mint)!.program);
      const ata = (mint: string) => getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, programOf(mint));
      const built = await m.Instruction.swapBaseInInstruction({
        poolInfo: state.poolInfo as unknown as Parameters<Sdk["Instruction"]["swapBaseInInstruction"]>[0]["poolInfo"],
        ownerInfo: {
          wallet: owner as unknown as PublicKey,
          tokenAccountA: ata(state.mintA),
          tokenAccountB: ata(state.mintB),
        },
        amount: new BN(quote.amountIn),
        otherAmountThreshold: new BN(minimumOut.toString()),
        sqrtPriceLimitX64: new BN(0),
        isInputMintA: quote.inputMint === state.mintA,
        exTickArrayBitmap: state.exBitmapInfo.exBitmapAddress,
        tickArray: fresh.remainingAccounts,
      } as unknown as Parameters<Sdk["Instruction"]["swapBaseInInstruction"]>[0]);

      const instructions = built.instructions as unknown as TransactionInstruction[];
      if (!instructions.length) return refuse("SDK_ERROR", "SDK returned no instructions");
      for (const ix of instructions) {
        if (ix.programId.toBase58() !== BYREAL_CLMM_PROGRAM)
          return refuse("SDK_ERROR", `instruction targets ${ix.programId.toBase58()}, not the Byreal CLMM program`);
        for (const k of ix.keys)
          if (k.isSigner && !k.pubkey.equals(owner))
            return refuse("INVALID_REQUEST", `venue instruction requires signer ${k.pubkey.toBase58()}`);
      }

      return {
        instructions,
        lookupTables: [],
        reason: null,
        detail: `ClmmInstrument.swapBaseInInstruction (swapV2); ${fresh.remainingAccounts.length} tick arrays; amountOutMin ${minimumOut}`,
      };
    } catch (error) {
      return refuse("SDK_ERROR", (error as Error).message);
    }
  }
}

export const byrealAdapter = new ByrealAdapter();
