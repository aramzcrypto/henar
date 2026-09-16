/**
 * Live statistics for the pool behind each strategy.
 *
 * These pools are real and running on their protocols today; what is not yet
 * built is Henar's deposit path into them. The figures here are therefore
 * read live and attributed, never modelled: a supply rate comes from Kamino,
 * a fee rate from Meteora, and each carries the window it was measured over
 * so a one-day number is never mistaken for a steady one.
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { provenance, type DataProvenance } from "@/lib/provenance";
import { KAMINO, KAMINO_SOURCE, reserveSnapshot } from "./adapters/kamino";
import { METEORA_SOURCE } from "./adapters/meteora";

const DATAPI = "https://dlmm.datapi.meteora.ag/pools";
const CACHE_MS = 60_000;

const poolSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  token_x: z.object({ address: z.string(), symbol: z.string().optional(), decimals: z.number().optional(), price: z.number().nullish() }),
  token_y: z.object({ address: z.string(), symbol: z.string().optional(), decimals: z.number().optional(), price: z.number().nullish() }),
  tvl: z.number().nullish(),
  current_price: z.number().nullish(),
  /** Meteora's own 24h fee-to-TVL ratio, as a percentage. */
  apr: z.number().nullish(),
  /** That ratio compounded over a year. Meteora publishes it; it annualizes one day. */
  apy: z.number().nullish(),
  volume: z.record(z.number().nullish()).nullish(),
  fees: z.record(z.number().nullish()).nullish(),
  pool_config: z.object({ bin_step: z.number().nullish(), base_fee_pct: z.number().nullish() }).nullish(),
  is_blacklisted: z.boolean().nullish(),
});

/** A figure with the window it was measured over and who published it. */
export type MeasuredRate = {
  /** Percent. */
  value: number;
  label: string;
  /** What the figure was measured over, in plain words. */
  window: string;
  source: string;
  /** Set when the figure is noisier than it looks. */
  caveat: string | null;
};

export type PoolStats = {
  status: "available" | "unavailable";
  protocol: "kamino" | "meteora-dlmm";
  address: string;
  pair: string | null;
  /** Total value in the pool or reserve, in USD. */
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  /** The rate a depositor would care about, or null when the strategy has none. */
  rate: MeasuredRate | null;
  /** Quote per whole stock unit. */
  price: number | null;
  binStep: number | null;
  baseFeePct: number | null;
  utilization: number | null;
  observedAt: string;
  reason: string | null;
  provenance: DataProvenance;
};

const cache = createReadCache<PoolStats>(CACHE_MS, 16);

/** Meteora DLMM pool statistics, from Meteora's own data API. */
export async function meteoraPoolStats(address: string, options: { fetch?: typeof fetch } = {}): Promise<PoolStats> {
  return cache(`meteora:${address}`, async () => {
    const observedAt = new Date().toISOString();
    const base = { protocol: "meteora-dlmm" as const, address, observedAt, provenance: provenance({ ...METEORA_SOURCE, sourceType: "dex-index", observedAt, url: `${DATAPI}/${address}` }) };
    const unavailable = (reason: string): PoolStats => ({
      ...base, status: "unavailable", pair: null, liquidityUsd: null, volume24hUsd: null, fees24hUsd: null,
      rate: null, price: null, binStep: null, baseFeePct: null, utilization: null, reason,
    });
    try {
      const doFetch = options.fetch ?? fetch;
      const response = await doFetch(`${DATAPI}/${address}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return unavailable(`Meteora responded ${response.status}`);
      const parsed = poolSchema.safeParse(await response.json());
      if (!parsed.success) return unavailable("Meteora returned an unexpected shape");
      const p = parsed.data;
      if (p.is_blacklisted) return unavailable("pool is blacklisted by Meteora");
      const apy = p.apy ?? null;
      return {
        ...base,
        status: "available",
        pair: p.name ?? null,
        liquidityUsd: p.tvl ?? null,
        volume24hUsd: p.volume?.["24h"] ?? null,
        fees24hUsd: p.fees?.["24h"] ?? null,
        /* Meteora publishes this as the last 24 hours of fees over TVL,
           compounded across a year. It is a real measurement of a short
           window, not a forecast, and it is labelled as exactly that. */
        rate: apy === null || !Number.isFinite(apy)
          ? null
          : { value: apy, label: "Pool fee APY", window: "last 24h of pool fees", source: "Meteora", caveat: "Annualizes a single day of trading; it moves with volume." },
        price: p.current_price ?? null,
        binStep: p.pool_config?.bin_step ?? null,
        baseFeePct: p.pool_config?.base_fee_pct ?? null,
        utilization: null,
        reason: null,
      };
    } catch (error) {
      return unavailable((error as Error).message);
    }
  });
}

/** Kamino reserve statistics, from Kamino's own metrics endpoint. */
export async function kaminoPoolStats(market: string, reserve: string): Promise<PoolStats> {
  return cache(`kamino:${reserve}`, async () => {
    const observedAt = new Date().toISOString();
    const base = { protocol: "kamino" as const, address: reserve, observedAt, provenance: provenance({ ...KAMINO_SOURCE, observedAt, url: KAMINO.metricsUrl(market) }) };
    const snapshot = await reserveSnapshot(market, reserve).catch(() => null);
    if (!snapshot)
      return {
        ...base, status: "unavailable", pair: null, liquidityUsd: null, volume24hUsd: null, fees24hUsd: null,
        rate: null, price: null, binStep: null, baseFeePct: null, utilization: null, reason: "Kamino reserve metrics are unavailable",
      };
    return {
      ...base,
      status: "available",
      pair: snapshot.liquidityToken,
      liquidityUsd: snapshot.totalSupplyUsd,
      volume24hUsd: null,
      fees24hUsd: null,
      rate: snapshot.supplyApy === null
        ? null
        : { value: snapshot.supplyApy, label: "Supply rate", window: "current", source: "Kamino", caveat: "Variable: it moves with borrowing demand." },
      price: null,
      binStep: null,
      baseFeePct: null,
      utilization: snapshot.utilization,
      reason: null,
    };
  });
}

/** The pool behind one strategy, whichever protocol it lives on. */
export async function statsForStrategy(input: { protocol: "kamino" | "meteora-dlmm"; address: string; market?: string }) {
  return input.protocol === "kamino"
    ? kaminoPoolStats(input.market ?? KAMINO.mainMarket, input.address)
    : meteoraPoolStats(input.address);
}

/* Presentation rules live in their own module so a client component can use
   them without importing a protocol SDK. Re-exported here for server callers
   that already hold pool statistics. */
export { depositAvailability, rateIsStrategyReturn, type DepositAvailability } from "./presentation";
