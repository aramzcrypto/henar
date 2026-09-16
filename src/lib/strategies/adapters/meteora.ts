/**
 * Meteora DLMM adapter.
 *
 * Two primitives, kept apart because they behave differently:
 *
 *  - a LIMIT ORDER fills one way. Once a bin's order age passes the order's,
 *    the fill is permanent and a price reversal does not undo it. This is
 *    what Smart Accumulate needs, and the only thing that delivers it.
 *  - an LP POSITION is a two-way market maker at every bin it occupies. It
 *    earns swap fees and its composition follows price. This is Range Yield.
 *
 * A one-sided LP position is NOT a limit order: deposit quote below price,
 * let it fill, and a bounce sells the stock back. No flag changes that, so
 * the adapter never offers one as an accumulation primitive.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import { provenance, type DataProvenance } from "@/lib/provenance";
import { fromPricePerLamport, pricePerLamportFromBinId } from "../ladder";

export const METEORA = {
  dlmmProgram: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  /** A limit order may span at most this many bins. */
  maxBinsPerLimitOrder: 50,
  /** Share of the limit-order fee that goes to participants. */
  limitOrderFeeShareBps: 5_000,
  docsUrl: "https://docs.meteora.ag/core-products/dlmm/limit-order",
} as const;

export const METEORA_SOURCE = { source: "Meteora", provider: "meteora", sourceType: "onchain" as const, url: METEORA.docsUrl };

type DlmmModule = typeof import("@meteora-ag/dlmm");
type DlmmClass = DlmmModule["default"];
let modulePromise: Promise<DlmmModule> | null = null;

/**
 * The package is CommonJS and exports the class as both default and DLMM.
 *
 * A dynamic `import()` resolves it inside Next, but under a plain ESM loader
 * its transitive Anchor import fails on a named export, which is why the
 * router's own venue package reaches for `require`. Both paths are tried so
 * the same adapter serves the app and the operator scripts.
 */
async function dlmmModule(): Promise<DlmmModule> {
  if (!modulePromise)
    modulePromise = import("@meteora-ag/dlmm").catch(async () => {
      const { createRequire } = await import("node:module");
      return createRequire(import.meta.url)("@meteora-ag/dlmm") as DlmmModule;
    });
  return modulePromise;
}
async function dlmmClass(): Promise<DlmmClass> {
  const mod = await dlmmModule();
  return ((mod as { default?: DlmmClass }).default ?? (mod as unknown as DlmmClass));
}

export type PoolState = {
  status: "available" | "unavailable";
  address: string;
  /** Token X, the stock side in every market Henar admits. */
  baseMint: string | null;
  baseDecimals: number | null;
  quoteMint: string | null;
  quoteDecimals: number | null;
  binStep: number | null;
  activeBinId: number | null;
  /** UI price of the active bin, quote per whole stock unit. */
  activePrice: string | null;
  /**
   * Whether this pool admits limit orders. Pools are limit-order mode or
   * liquidity-mining mode, never both, and one that ever had a reward mint
   * is permanently excluded.
   */
  supportsLimitOrders: boolean | null;
  slot: number | null;
  readAt: string;
  reason: string | null;
  provenance: DataProvenance;
};

/**
 * Whether a pool admits limit orders, from its own parameters.
 *
 * functionType 2 is limit-order mode, 1 is liquidity-mining mode, and 0 is
 * undetermined — which resolves to limit orders only while no reward mint is
 * set. Mirrors the SDK's `isSupportLimitOrder` so the rule is visible here
 * rather than hidden behind an import.
 */
export function supportsLimitOrders(lbPair: { parameters?: { functionType?: number }; rewardInfos?: { mint: { toBase58?: () => string } | string }[] }) {
  const functionType = lbPair.parameters?.functionType;
  if (functionType === 2) return true;
  if (functionType === 1) return false;
  const none = PublicKey.default.toBase58();
  return (lbPair.rewardInfos ?? []).every((r) => {
    const mint = typeof r.mint === "string" ? r.mint : (r.mint?.toBase58?.() ?? none);
    return mint === none;
  });
}

export async function readPool(connection: Connection, address: string, options: { now?: () => number } = {}): Promise<PoolState> {
  const readAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const base = { address, readAt, provenance: provenance({ ...METEORA_SOURCE, observedAt: readAt, freshness: "fresh" as const }) };
  const unavailable = (reason: string): PoolState => ({
    ...base, status: "unavailable", baseMint: null, baseDecimals: null, quoteMint: null, quoteDecimals: null,
    binStep: null, activeBinId: null, activePrice: null, supportsLimitOrders: null, slot: null, reason,
  });
  try {
    const DLMM = await dlmmClass();
    const [pool, slot] = await Promise.all([
      DLMM.create(connection, new PublicKey(address), { cluster: "mainnet-beta" }),
      connection.getSlot("confirmed"),
    ]);
    const lbPair = pool.lbPair as unknown as { binStep: number; activeId: number; parameters?: { functionType?: number }; rewardInfos?: { mint: { toBase58?: () => string } }[] };
    const baseDecimals = pool.tokenX.mint.decimals;
    const quoteDecimals = pool.tokenY.mint.decimals;
    const activePrice = fromPricePerLamport(pricePerLamportFromBinId(lbPair.activeId, lbPair.binStep), baseDecimals, quoteDecimals);
    return {
      ...base,
      status: "available",
      baseMint: pool.tokenX.publicKey.toBase58(),
      baseDecimals,
      quoteMint: pool.tokenY.publicKey.toBase58(),
      quoteDecimals,
      binStep: lbPair.binStep,
      activeBinId: lbPair.activeId,
      activePrice: Number(activePrice).toFixed(8).replace(/\.?0+$/, ""),
      supportsLimitOrders: supportsLimitOrders(lbPair),
      slot,
      reason: null,
    };
  } catch (error) {
    return unavailable((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Limit orders (Smart Accumulate)
// ---------------------------------------------------------------------------

export type LimitOrderBin = { binId: number; amount: string; status: "NotFilled" | "PartialFilled" | "Fulfilled" };

export type LimitOrderState = {
  status: "available" | "unavailable";
  pool: string;
  owner: string;
  orders: {
    address: string;
    /** Deposited, unfilled, filled and swapped amounts, in display units per the SDK's parser. */
    totalDepositQuote: string;
    totalUnfilledQuote: string;
    totalFilledBase: string;
    totalFeeBase: string;
    totalFeeQuote: string;
    /** Net of any Token-2022 transfer fee: what settlement actually delivers. */
    withdrawableBase: string;
    withdrawableQuote: string;
    bins: LimitOrderBin[];
  }[];
  slot: number | null;
  readAt: string;
  reason: string | null;
  provenance: DataProvenance;
};

export async function readLimitOrders(connection: Connection, pool: string, owner: string, options: { now?: () => number } = {}): Promise<LimitOrderState> {
  const readAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const base = { pool, owner, readAt, provenance: provenance({ ...METEORA_SOURCE, observedAt: readAt, freshness: "fresh" as const }) };
  try {
    const DLMM = await dlmmClass();
    const mod = await dlmmModule();
    const [instance, slot] = await Promise.all([
      DLMM.create(connection, new PublicKey(pool), { cluster: "mainnet-beta" }),
      connection.getSlot("confirmed"),
    ]);
    const statusNames = (mod as unknown as { LimitOrderStatus?: Record<number, string> }).LimitOrderStatus ?? { 0: "NotFilled", 1: "PartialFilled", 2: "Fulfilled" };
    const parsed = await instance.getLimitOrderByUserAndLbPair(new PublicKey(owner));
    const orders = parsed.map((entry) => {
      const d = entry.limitOrderData as unknown as Record<string, unknown> & { limitOrderBinData?: { binId: number; amount: string; status: number }[] };
      const text = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "0");
      return {
        address: entry.publicKey.toBase58(),
        totalDepositQuote: text("totalDepositAmountY"),
        totalUnfilledQuote: text("totalUnfilledAmountY"),
        totalFilledBase: text("totalFilledAmountX"),
        totalFeeBase: text("totalFeeAmountX"),
        totalFeeQuote: text("totalFeeAmountY"),
        withdrawableBase: text("transferFeeExcludedWithdrawableAmountX"),
        withdrawableQuote: text("transferFeeExcludedWithdrawableAmountY"),
        bins: (d.limitOrderBinData ?? []).map((b) => ({ binId: b.binId, amount: String(b.amount), status: (statusNames[b.status] ?? "NotFilled") as LimitOrderBin["status"] })),
      };
    });
    return { ...base, status: "available", orders, slot, reason: null };
  } catch (error) {
    return { ...base, status: "unavailable", orders: [], slot: null, reason: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// LP positions (Range Yield)
// ---------------------------------------------------------------------------

export type DlmmPositionState = {
  status: "available" | "unavailable";
  pool: string;
  owner: string;
  positions: {
    address: string;
    lowerBinId: number;
    upperBinId: number;
    /** Raw base units. */
    baseAmount: string;
    quoteAmount: string;
    /** Net of any Token-2022 transfer fee. */
    baseAmountNet: string;
    quoteAmountNet: string;
    feeBase: string;
    feeQuote: string;
    feeBaseNet: string;
    feeQuoteNet: string;
    claimedFeeBase: string;
    claimedFeeQuote: string;
    feeOwner: string;
    positionOwner: string;
    lastUpdatedAt: string;
  }[];
  activeBinId: number | null;
  slot: number | null;
  readAt: string;
  reason: string | null;
  provenance: DataProvenance;
};

export async function readPositions(connection: Connection, pool: string, owner: string, options: { now?: () => number } = {}): Promise<DlmmPositionState> {
  const readAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const base = { pool, owner, readAt, provenance: provenance({ ...METEORA_SOURCE, observedAt: readAt, freshness: "fresh" as const }) };
  try {
    const DLMM = await dlmmClass();
    const [instance, slot] = await Promise.all([
      DLMM.create(connection, new PublicKey(pool), { cluster: "mainnet-beta" }),
      connection.getSlot("confirmed"),
    ]);
    const { activeBin, userPositions } = await instance.getPositionsByUserAndLbPair(new PublicKey(owner));
    const positions = userPositions.map((p) => {
      const d = p.positionData;
      const text = (value: unknown) => (value === null || value === undefined ? "0" : typeof value === "string" ? value : String(value));
      return {
        address: p.publicKey.toBase58(),
        lowerBinId: d.lowerBinId,
        upperBinId: d.upperBinId,
        baseAmount: text(d.totalXAmount),
        quoteAmount: text(d.totalYAmount),
        baseAmountNet: text(d.totalXAmountExcludeTransferFee?.toString?.() ?? d.totalXAmount),
        quoteAmountNet: text(d.totalYAmountExcludeTransferFee?.toString?.() ?? d.totalYAmount),
        feeBase: text(d.feeX?.toString?.()),
        feeQuote: text(d.feeY?.toString?.()),
        feeBaseNet: text(d.feeXExcludeTransferFee?.toString?.() ?? d.feeX?.toString?.()),
        feeQuoteNet: text(d.feeYExcludeTransferFee?.toString?.() ?? d.feeY?.toString?.()),
        claimedFeeBase: text(d.totalClaimedFeeXAmount?.toString?.()),
        claimedFeeQuote: text(d.totalClaimedFeeYAmount?.toString?.()),
        feeOwner: d.feeOwner?.toBase58?.() ?? PublicKey.default.toBase58(),
        positionOwner: d.owner?.toBase58?.() ?? PublicKey.default.toBase58(),
        lastUpdatedAt: new Date(Number(d.lastUpdatedAt?.toString?.() ?? 0) * 1000).toISOString(),
      };
    });
    return { ...base, status: "available", positions, activeBinId: activeBin?.binId ?? null, slot, reason: null };
  } catch (error) {
    return { ...base, status: "unavailable", positions: [], activeBinId: null, slot: null, reason: (error as Error).message };
  }
}

/**
 * What the operator of an LP position may actually do, as verified against
 * the SDK and IDL. Recorded per position so the UI and the runner act on the
 * protocol's real authority rather than on the word "operator".
 */
export function dlmmAuthorityFacts() {
  return {
    operatorCan: {
      addLiquidity: true,
      removeLiquidity: true,
      closePosition: false,
      claimFees: true,
      /** Withdrawn principal is force-routed to the owner's token accounts. */
      withdrawPrincipalToSelf: false,
    },
    verifiedBy: "@meteora-ag/dlmm 1.9.14 removeLiquidity derives user token accounts from positionState.owner(); closePosition hardcodes the owner as sender",
    notes: [
      "Operator actions are only possible after the position's lock release point.",
      "Claimed fees go to feeOwner, not to whoever signed the claim.",
      "enablePositionPermissionlessClaimFee lets any keeper claim fees to feeOwner without any power over principal.",
      "Limit orders have no operator concept: cancel and close require the owner's signature, so settlement cannot be automated.",
    ],
  };
}
