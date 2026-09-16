/**
 * Kamino lending adapter.
 *
 * Reads a reserve's current supply rate and a position's value. Deposits and
 * withdrawals are not built here: this version deploys capital by hand, and
 * only the owner of an obligation can move it — klend has no operator or
 * delegate, so there is nothing for automation to sign.
 *
 * The reserve is pinned by address. Kamino's MAIN market holds four reserves
 * whose liquidity mint is USDC, three of them dust, so looking one up by mint
 * would be a coin flip.
 */
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { createReadCache } from "@/lib/read-cache";
import { provenance, type DataProvenance } from "@/lib/provenance";
import { accruedYield, raw, toBig, type YieldBasis } from "../accounting";

/** Kamino programs and the markets Henar reads. */
export const KAMINO = {
  klendProgram: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  /** The primary market. */
  mainMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  /** The real USDC reserve in MAIN, pinned because three decoys share its mint. */
  mainUsdcReserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
  xstocksMarket: "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua",
  metricsUrl: (market: string) => `https://api.kamino.finance/kamino-market/${market}/reserves/metrics`,
  docsUrl: "https://kamino.com/docs/products/borrow/supplying",
} as const;

export const KAMINO_SOURCE = { source: "Kamino", provider: "kamino", sourceType: "provider-catalog" as const, url: KAMINO.docsUrl };

/**
 * Kamino publishes these as decimal strings, and for very small values in
 * scientific notation ("5.601919084163853e-8"). A parser that only accepted
 * plain decimals rejected the whole MAIN market because two SOL reserves had
 * a near-zero rate, so the number is parsed rather than pattern-matched.
 */
const numeric = z
  .string()
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative());
const reserveSchema = z.object({
  reserve: z.string(),
  liquidityTokenMint: z.string(),
  liquidityToken: z.string(),
  supplyApy: numeric.nullable().optional(),
  borrowApy: numeric.nullable().optional(),
  totalSupplyUsd: numeric.nullable().optional(),
  totalSupply: numeric.nullable().optional(),
  totalBorrow: numeric.nullable().optional(),
});

export type KaminoReserveSnapshot = {
  reserve: string;
  market: string;
  liquidityTokenMint: string;
  liquidityToken: string;
  /** Percent, e.g. 3.76. The endpoint publishes a fraction; it is scaled here once. */
  supplyApy: number | null;
  totalSupplyUsd: number | null;
  utilization: number | null;
  observedAt: string;
  provenance: DataProvenance;
};

const cache = createReadCache<KaminoReserveSnapshot[]>(60_000, 4);

/** Every reserve in a market, normalized. Throws only when the market is unreadable. */
export async function reserveSnapshots(market: string, options: { fetch?: typeof fetch } = {}): Promise<KaminoReserveSnapshot[]> {
  return cache(market, async () => {
    const doFetch = options.fetch ?? fetch;
    const response = await doFetch(KAMINO.metricsUrl(market), { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Kamino reserve metrics unavailable (status ${response.status})`);
    const observedAt = new Date().toISOString();
    /* One unparseable reserve must not cost the caller every other one: rows
       are validated individually and a bad row is dropped, not fatal. */
    const rows = z.array(z.unknown()).parse(await response.json());
    return rows
      .map((row) => reserveSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .map((r) => ({
      reserve: r.reserve,
      market,
      liquidityTokenMint: r.liquidityTokenMint,
      liquidityToken: r.liquidityToken,
      // The endpoint returns a fraction; percent is what every caller wants.
      supplyApy: r.supplyApy === null || r.supplyApy === undefined ? null : r.supplyApy * 100,
      totalSupplyUsd: r.totalSupplyUsd ?? null,
      utilization: r.totalSupply && r.totalBorrow !== null && r.totalBorrow !== undefined && r.totalSupply > 0 ? Math.min(r.totalBorrow / r.totalSupply, 1) : null,
      observedAt,
      provenance: provenance({ ...KAMINO_SOURCE, sourceType: "provider-catalog", observedAt, url: KAMINO.metricsUrl(market) }),
    }));
  });
}

/** One reserve by address. Null when the market does not carry it. */
export async function reserveSnapshot(market: string, reserve: string) {
  const all = await reserveSnapshots(market).catch(() => [] as KaminoReserveSnapshot[]);
  return all.find((r) => r.reserve === reserve) ?? null;
}

// ---------------------------------------------------------------------------
// Position reading
// ---------------------------------------------------------------------------

export type KaminoPosition = {
  status: "available" | "unavailable";
  market: string;
  reserve: string;
  owner: string;
  /** Collateral base units held. Constant between deposits; the rate moves. */
  collateralAmount: string | null;
  /** What the collateral is worth in liquidity base units right now. */
  liquidityValue: string | null;
  /** collateral-per-liquidity, as a decimal string. */
  exchangeRate: string | null;
  slot: number | null;
  readAt: string;
  reason: string | null;
  provenance: DataProvenance;
};

export type KaminoAdapterDeps = {
  /**
   * Reads a position through the klend SDK. Injected so the strategy engine
   * is testable without an RPC, and so the SDK loads only where it is used.
   */
  readPosition?: (input: { market: string; reserve: string; owner: string }) => Promise<{ collateralAmount: bigint; liquidityValue: bigint; exchangeRate: string; slot: number } | null>;
  now?: () => number;
};

export async function kaminoPosition(input: { market: string; reserve: string; owner: string }, deps: KaminoAdapterDeps = {}): Promise<KaminoPosition> {
  const readAt = new Date(deps.now?.() ?? Date.now()).toISOString();
  const base = { market: input.market, reserve: input.reserve, owner: input.owner, readAt, provenance: provenance({ ...KAMINO_SOURCE, sourceType: "onchain", observedAt: readAt }) };
  const unavailable = (reason: string): KaminoPosition => ({ ...base, status: "unavailable", collateralAmount: null, liquidityValue: null, exchangeRate: null, slot: null, reason });
  try {
    new PublicKey(input.owner);
    new PublicKey(input.reserve);
  } catch {
    return unavailable("owner or reserve is not a Solana address");
  }
  if (!deps.readPosition) return unavailable("no position reader configured");
  try {
    const read = await deps.readPosition(input);
    if (!read) return unavailable("no Kamino position for this owner in this reserve");
    return { ...base, status: "available", collateralAmount: raw(read.collateralAmount), liquidityValue: raw(read.liquidityValue), exchangeRate: read.exchangeRate, slot: read.slot, reason: null };
  } catch (error) {
    return unavailable((error as Error).message);
  }
}

/**
 * Realized yield for a position against a recorded basis.
 *
 * klend keeps no cost basis, so the basis is Henar's own record of what was
 * supplied and at what rate. Without one, yield is unknown — which is a
 * different statement from zero, and is reported as such.
 */
export function positionYield(position: KaminoPosition, basis: YieldBasis | null) {
  if (position.status !== "available" || position.liquidityValue === null) return { accrued: null, reason: position.reason ?? "position unavailable" };
  if (!basis) return { accrued: null, reason: "no recorded deposit basis; yield cannot be derived" };
  return { accrued: accruedYield(toBig(position.liquidityValue), basis), reason: null };
}

/**
 * The basis to record at deposit. Called once per deposit and again after a
 * harvest, so repeated harvests stay correct.
 */
export function recordBasis(input: { collateralAmount: bigint; liquidityValue: bigint; exchangeRate: string; at?: string }): YieldBasis {
  return {
    collateralAmount: raw(input.collateralAmount),
    exchangeRateAtBasis: input.exchangeRate,
    liquidityAtBasis: raw(input.liquidityValue),
    recordedAt: input.at ?? new Date().toISOString(),
  };
}
