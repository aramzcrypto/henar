/**
 * Company-level on-chain activity, derived from the catalog-wide market pass.
 *
 * Two things become possible once the whole catalog is read rather than a
 * window of it. Ranked views can rank the universe instead of the first fifty
 * tickers in alphabetical order. And "liquid" stops being a feeling: a
 * company qualifies when at least one of its verified mints has both traded
 * in the last 24 hours and holds pooled liquidity above a stated floor.
 *
 * The floor is declared here and disclosed in the interface, because a filter
 * whose rule is hidden is just an opinion with a checkbox.
 */
import { catalogMarket, tradedVolume, type CatalogMarket } from "./catalog-market";
import { equityRegistry } from "./registry";
import type { Equity, EquityProvider } from "./types";

/**
 * Pooled liquidity a single mint must hold before its company counts as
 * liquid. Measured on 20 September 2026 against the live catalog: 101
 * companies traded at all in 24 hours, 75 of those cleared this floor.
 */
export const LIQUID_FLOOR_USD = 10_000;

export type CompanyActivity = {
  ticker: string;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  /** Mints of this company with a non-zero 24h traded volume. */
  tradedMints: number;
  /** Mints clearing the liquidity floor with volume behind them. */
  liquidMints: number;
  representations: number;
};

export type ActivityIndex = {
  byTicker: Map<string, CompanyActivity>;
  observedAt: string;
  complete: boolean;
};

function add(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return left + right;
}

/**
 * Fold a catalog pass into one row per company. Pure.
 *
 * `provider` scopes the fold to one issuer's mints. Without it, a reader who
 * has filtered to Ondo and asked for liquid companies would be shown a
 * company whose xStocks token clears the floor while its Ondo token has no
 * market at all — the filter would be answering about a token they excluded.
 */
export function activityIndex(
  market: CatalogMarket,
  equities: Equity[] = equityRegistry,
  provider?: EquityProvider,
): ActivityIndex {
  const byTicker = new Map<string, CompanyActivity>();
  for (const equity of equities) {
    const representations = provider
      ? equity.representations.filter((item) => item.provider === provider)
      : equity.representations;
    const row: CompanyActivity = {
      ticker: equity.ticker,
      volume24hUsd: null,
      liquidityUsd: null,
      holders: null,
      tradedMints: 0,
      liquidMints: 0,
      representations: representations.length,
    };
    for (const representation of representations) {
      const entry = market.entries.get(representation.mint);
      if (!entry) continue;
      const volume = tradedVolume(entry);
      const liquidity = entry.liquidity ?? null;
      row.volume24hUsd = add(row.volume24hUsd, volume);
      row.liquidityUsd = add(row.liquidityUsd, liquidity);
      row.holders = add(row.holders, entry.holderCount ?? null);
      if ((volume ?? 0) > 0) row.tradedMints += 1;
      if ((volume ?? 0) > 0 && (liquidity ?? 0) >= LIQUID_FLOOR_USD) row.liquidMints += 1;
    }
    byTicker.set(equity.ticker, row);
  }
  return { byTicker, observedAt: market.observedAt, complete: market.complete };
}

export type LiquidityFilter = "traded" | "liquid";

/** Whether a company passes a liquidity filter. A company with no read fails. */
export function passesLiquidity(activity: CompanyActivity | undefined, filter: LiquidityFilter) {
  if (!activity) return false;
  return filter === "traded" ? activity.tradedMints > 0 : activity.liquidMints > 0;
}

export async function companyActivity(
  options: { fetch?: typeof fetch; fresh?: boolean; provider?: EquityProvider } = {},
) {
  return activityIndex(await catalogMarket(options), equityRegistry, options.provider);
}
