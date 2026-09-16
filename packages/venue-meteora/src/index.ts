/**
 * Meteora DLMM as a direct venue.
 *
 * Interface-complete, evidence-gated. Inspection found no DLMM pairs for any
 * equity mint through Meteora's HTTP endpoints, and RPC discovery
 * (`scripts/router/discover-meteora-pools.ts`) has not yet run. Until a DLMM
 * pair is in the verified registry and enabled, every quote is
 * NO_VERIFIED_POOL. That is the truthful state, not an error.
 *
 * When a pool is present the quote comes from the official SDK:
 * `DLMM.create` → `getBinArrayForSwap` → `swapQuote`. No bin math lives here.
 *
 * Bin-array loading. `swapQuote` only walks the bin arrays it is handed. With
 * `isPartialFill = false` the SDK throws SWAP_QUOTE_INSUFFICIENT_LIQUIDITY as
 * soon as it runs past the last loaded array — which means "not enough
 * loaded", not necessarily "not enough liquidity". `getBinArrayForSwap`
 * stops early (returns fewer than `count`) only when the pair's bitmap has
 * no further liquidity in that direction, so:
 *   - fewer arrays than requested → the pool is genuinely exhausted;
 *   - exactly `count` arrays and the SDK throws → load more and retry.
 * The retry ladder is bounded by MAX_BIN_ARRAYS; past it the adapter reports
 * INSUFFICIENT_LIQUIDITY with the bound in the detail so the limitation is
 * visible rather than mistaken for pool depth. The bound also keeps the
 * eventual swap within the account limit of one transaction.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import {
  toRaw,
  unavailableQuote,
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

export const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const QUOTE_TTL_MS = 15_000;
/** Bin-array counts tried in order. 4 is the SDK default. */
export const BIN_ARRAY_LADDER = [4, 8, 16] as const;
export const MAX_BIN_ARRAYS = BIN_ARRAY_LADDER[BIN_ARRAY_LADDER.length - 1];

type DlmmClass = typeof import("@meteora-ag/dlmm").default;
type Dlmm = InstanceType<DlmmClass>;
let dlmmPromise: Promise<DlmmClass> | null = null;
function dlmm() {
  if (!dlmmPromise)
    dlmmPromise = import("@meteora-ag/dlmm").then(
      // CJS build: the module object is the class, with default/DLMM aliases.
      (m) => ((m as { default?: DlmmClass }).default ?? (m as unknown as DlmmClass)),
    );
  return dlmmPromise;
}

function pickPool(pools: VerifiedPool[]) {
  const usable = pools.filter(
    (p) => p.venue === "meteora" && p.enabled && p.poolType === "dlmm" && p.programId === METEORA_DLMM_PROGRAM,
  );
  usable.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  return usable[0] ?? null;
}

function isInsufficientLiquidity(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const name = (error as { name?: string })?.name ?? "";
  return /SWAP_QUOTE_INSUFFICIENT_LIQUIDITY|insufficient liquidity/i.test(`${name} ${message}`);
}

export type BinArrayQuoteOutcome =
  | { ok: true; quote: ReturnType<Dlmm["swapQuote"]>; binArraysLoaded: number }
  | { ok: false; reason: "exhausted" | "bounded"; binArraysLoaded: number; detail: string };

/**
 * Quote with progressively more bin arrays until the SDK can fill the whole
 * amount, the pool runs out of liquidity, or the bound is hit.
 */
export async function quoteWithBinArrays(
  instance: Pick<Dlmm, "getBinArrayForSwap" | "swapQuote">,
  amount: BN,
  swapForY: boolean,
  ladder: readonly number[] = BIN_ARRAY_LADDER,
): Promise<BinArrayQuoteOutcome> {
  let loaded = 0;
  for (const count of ladder) {
    const binArrays = await instance.getBinArrayForSwap(swapForY, count);
    loaded = binArrays.length;
    try {
      const quote = instance.swapQuote(amount, swapForY, new BN(0), binArrays, false);
      return { ok: true, quote, binArraysLoaded: loaded };
    } catch (error) {
      if (!isInsufficientLiquidity(error)) throw error;
      if (loaded < count)
        return {
          ok: false,
          reason: "exhausted",
          binArraysLoaded: loaded,
          detail: `pool has no further liquidity in this direction after ${loaded} bin arrays`,
        };
    }
  }
  return {
    ok: false,
    reason: "bounded",
    binArraysLoaded: loaded,
    detail: `amount not fillable within ${MAX_BIN_ARRAYS} bin arrays (adapter bound, not necessarily pool depth)`,
  };
}

/**
 * One `swapQuote` result reduced to a `VenueQuote`.
 *
 * Shared by `getQuote` and by the curve's `quoteFor`, so a leg the split
 * optimizer allocates is priced by exactly the code that priced the whole
 * order. Returns null when the pool cannot fill the amount asked, which the
 * curve reports as "cannot fill" and the quote path reports as insufficient
 * liquidity.
 */
function buildQuote(
  request: QuoteRequest,
  pool: VerifiedPool,
  instance: Pick<Dlmm, "lbPair">,
  quote: ReturnType<Dlmm["swapQuote"]>,
  binArraysLoaded: number,
  slot: number,
  ctx: QuoteContext,
  amountIn: bigint = BigInt(request.amount),
): VenueQuote | null {
  const consumed = BigInt(quote.consumedInAmount.toString());
  const out = BigInt(quote.outAmount.toString());
  if (consumed !== amountIn || out <= 0n) return null;
  const impact = Number(quote.priceImpact.toString());
  return {
    venue: "meteora",
    routeType: "DEX",
    representationId: request.representationId,
    poolAddress: pool.address,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amountIn: toRaw(consumed),
    expectedAmountOut: toRaw(out),
    minimumAmountOut: null,
    effectivePrice: null,
    venueFeeBps: pool.feeBps,
    venueFeeAmount: toRaw(BigInt(quote.fee.toString())),
    estimatedNetworkCostLamports: null,
    priceImpactBps: Number.isFinite(impact) ? Math.round(impact * 100) : null,
    slot,
    quotedAt: new Date(ctx.now).toISOString(),
    expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
    source: "@meteora-ag/dlmm swapQuote",
    executionPath: "none",
    // Mints and program re-read from chain by the caller matched the registry.
    onchainCheckedAtQuote: true,
    unavailableReason: null,
    unavailableDetail: null,
    rawRouteMetadata: {
      binStep: instance.lbPair.binStep,
      activeId: instance.lbPair.activeId,
      binArraysLoaded,
      binArrays: quote.binArraysPubkey.map((k: PublicKey) => k.toBase58()),
      feeOnInput: quote.feeOnInput,
      protocolFee: quote.protocolFee.toString(),
    },
  };
}

/**
 * Price an arbitrary amount against bin arrays that were already fetched.
 *
 * `swapQuote` is synchronous, so once the arrays are in hand every allocation
 * the split optimizer wants to try is a pure call. Returned null means "this
 * pool cannot fill that amount": either the SDK said there is no liquidity,
 * or it filled only part of the amount, which is not an output for the amount
 * asked and must never be presented as one.
 */
export function cachedBinArrayQuote(
  instance: Pick<Dlmm, "swapQuote">,
  binArrays: Parameters<Dlmm["swapQuote"]>[3],
  swapForY: boolean,
) {
  return (amountIn: bigint): ReturnType<Dlmm["swapQuote"]> | null => {
    if (amountIn <= 0n) return null;
    let quote: ReturnType<Dlmm["swapQuote"]>;
    try {
      quote = instance.swapQuote(new BN(amountIn.toString()), swapForY, new BN(0), binArrays, false);
    } catch (error) {
      if (isInsufficientLiquidity(error)) return null;
      throw error;
    }
    if (BigInt(quote.consumedInAmount.toString()) !== amountIn) return null;
    if (BigInt(quote.outAmount.toString()) <= 0n) return null;
    return quote;
  };
}

export class MeteoraAdapter implements VenueAdapter {
  readonly venue = "meteora" as const;

  capabilities(): VenueCapabilities {
    return {
      venue: "meteora",
      quote: true,
      legacyExecution: false,
      nativeBuild: false,
      poolTypes: ["dlmm"],
      supportsMinOut: true,
      supportsToken2022: true,
    };
  }

  async health(ctx: QuoteContext): Promise<VenueHealth> {
    const checkedAt = new Date(ctx.now).toISOString();
    if (!ctx.connection)
      return { venue: "meteora", healthy: false, checkedAt, detail: "no RPC connection" };
    try {
      await ctx.connection.getSlot("processed");
      return { venue: "meteora", healthy: true, checkedAt, detail: null };
    } catch (error) {
      return {
        venue: "meteora",
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
    ) => unavailableQuote("meteora", request, reason, detail, pool, ctx.now);

    if (request.amountType !== "input") return fail("NOT_IMPLEMENTED", "exact-out");
    const pool = pickPool(ctx.pools);
    if (!pool) return fail("NO_VERIFIED_POOL", "no enabled Meteora DLMM pool");
    if (!ctx.connection) return fail("VENUE_NOT_CONFIGURED", "no RPC connection", pool.address);

    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint))
      return fail("QUOTE_TERMS_MISMATCH", "request mints are not the pool pair", pool.address);

    try {
      const DLMM = await dlmm();
      const connection: Connection = ctx.connection;
      const [instance, slot] = await Promise.all([
        DLMM.create(connection, new PublicKey(pool.address), { cluster: "mainnet-beta" }),
        connection.getSlot("confirmed"),
      ]);

      const x = instance.tokenX.publicKey.toBase58();
      const y = instance.tokenY.publicKey.toBase58();
      if (!(pair.has(x) && pair.has(y)))
        return fail("QUOTE_TERMS_MISMATCH", "on-chain mints differ from registry pool", pool.address);
      if (instance.program.programId.toBase58() !== pool.programId)
        return fail("QUOTE_TERMS_MISMATCH", "on-chain program differs from registry pool", pool.address);

      const swapForY = request.inputMint === x;
      const outcome = await quoteWithBinArrays(instance, new BN(request.amount), swapForY);
      if (!outcome.ok) return fail("INSUFFICIENT_LIQUIDITY", outcome.detail, pool.address);

      const built = buildQuote(request, pool, instance, outcome.quote, outcome.binArraysLoaded, slot, ctx);
      if (!built) return fail("INSUFFICIENT_LIQUIDITY", "pool cannot fill the full amount", pool.address);
      return built;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = isInsufficientLiquidity(error)
        ? "INSUFFICIENT_LIQUIDITY"
        : /timeout|abort/i.test(message)
          ? "VENUE_TIMEOUT"
          : "SDK_ERROR";
      return fail(reason, message, pool.address);
    }
  }

  /**
   * A pure output curve over one DLMM pool.
   *
   * `swapQuote` is synchronous; only fetching the bin arrays is not. So the
   * arrays are loaded once here, at the widest bound the adapter will walk,
   * and every allocation the split optimizer tries is then priced off that
   * one read. Without this the optimizer could never place a leg on Meteora,
   * whatever the registry held: it splits across curves, and Meteora had
   * none. Measured on 16 September 2026, Meteora DLMM appears in 13% of
   * winning external routes for Henar's listed equities.
   *
   * An amount the cached arrays cannot fill returns null rather than a
   * partial fill, so the optimizer allocates away from it exactly as it does
   * for a pool that is out of liquidity.
   */
  async curve(request: QuoteRequest, pool: VerifiedPool, ctx: QuoteContext): Promise<VenueCurve | null> {
    if (!ctx.connection || pool.venue !== "meteora" || !pool.enabled) return null;
    const pair = new Set([pool.baseMint, pool.quoteMint]);
    if (!pair.has(request.inputMint) || !pair.has(request.outputMint)) return null;
    try {
      const DLMM = await dlmm();
      const connection: Connection = ctx.connection;
      const [instance, slot] = await Promise.all([
        DLMM.create(connection, new PublicKey(pool.address), { cluster: "mainnet-beta" }),
        connection.getSlot("confirmed"),
      ]);
      const x = instance.tokenX.publicKey.toBase58();
      const y = instance.tokenY.publicKey.toBase58();
      if (!(pair.has(x) && pair.has(y))) return null;
      if (instance.program.programId.toBase58() !== pool.programId) return null;

      const swapForY = request.inputMint === x;
      const binArrays = await instance.getBinArrayForSwap(swapForY, MAX_BIN_ARRAYS);
      if (!binArrays.length) return null;

      const priceAt = cachedBinArrayQuote(instance, binArrays, swapForY);

      return {
        venue: "meteora",
        poolAddress: pool.address,
        available: true,
        outputFor: (amountIn) => {
          if (amountIn <= 0n) return 0n;
          try {
            const q = priceAt(amountIn);
            return q ? BigInt(q.outAmount.toString()) : null;
          } catch {
            return null;
          }
        },
        quoteFor: (amountIn) => {
          const q = priceAt(amountIn);
          const built = q ? buildQuote(request, pool, instance, q, binArrays.length, slot, ctx, amountIn) : null;
          if (!built) throw new Error(`meteora cannot fill ${amountIn} on ${pool.address}`);
          return built;
        },
      };
    } catch {
      return null;
    }
  }

  async buildSwapInstructions(): Promise<BuildResult> {
    return {
      instructions: [],
      lookupTables: [],
      reason: "NOT_IMPLEMENTED",
      detail: "Meteora direct execution is Task 15.",
    };
  }
}

export const meteoraAdapter = new MeteoraAdapter();
export * from "./native";
