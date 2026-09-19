import rawCatalog from "@/data/stocks.json";
import sources from "@/data/stock-sources.json";
import { adaptBackpack } from "./providers/backpack";
import type { CatalogEntry } from "./providers/common";
import { adaptOndo } from "./providers/ondo";
import { adaptXStocks } from "./providers/xstocks";
import { industryForTicker, sectorForTicker, type Sector } from "./sectors";
import type { Equity, EquityProvider, Representation } from "./types";

/**
 * The catalog with each issuer's source URL rejoined.
 *
 * `source` lives in a side file rather than in stocks.json, because
 * stocks.json is imported by client components and the field is 136 KB of
 * provenance that no browser needs. This module is server-side, so it can put
 * the two back together at no cost to the bundle. Everything downstream —
 * provider identification, `sourceUrl` on a representation, the issuer link on
 * a market page — sees exactly the shape it always did.
 */
const sourceByMint = sources as Record<string, string>;
const catalog = (rawCatalog as Omit<CatalogEntry, "source">[]).map(
  (entry): CatalogEntry => ({ ...entry, source: sourceByMint[entry.mint] ?? "" }),
);
const providerOrder: EquityProvider[] = ["backpack", "xstocks", "ondo"];

function adapt(entry: CatalogEntry): Representation {
  if (entry.provider === "Backpack") return adaptBackpack(entry);
  if (entry.provider === "xStocks") return adaptXStocks(entry);
  return adaptOndo(entry);
}

function companyName(entries: CatalogEntry[]) {
  return [...entries].sort((a, b) => {
    const genericA =
      a.name.toUpperCase() === a.underlying.toUpperCase() ? 1 : 0;
    const genericB =
      b.name.toUpperCase() === b.underlying.toUpperCase() ? 1 : 0;
    if (genericA !== genericB) return genericA - genericB;
    const providerA = ["xStocks", "Ondo", "Backpack"].indexOf(a.provider);
    const providerB = ["xStocks", "Ondo", "Backpack"].indexOf(b.provider);
    return providerA - providerB || a.name.length - b.name.length;
  })[0].name;
}

function buildRegistry() {
  const grouped = new Map<string, CatalogEntry[]>();
  for (const entry of catalog) {
    const ticker = entry.underlying.trim().toUpperCase();
    if (!ticker || !entry.mint || !entry.source)
      throw new Error("Incomplete equity catalog entry.");
    grouped.set(ticker, [...(grouped.get(ticker) ?? []), entry]);
  }
  return [...grouped.entries()]
    .map(([ticker, entries]): Equity => {
      const representations = entries
        .map(adapt)
        .sort(
          (a, b) =>
            providerOrder.indexOf(a.provider) -
            providerOrder.indexOf(b.provider),
        );
      return {
        id: `equity:${ticker}`,
        name: companyName(entries),
        ticker,
        cik: null,
        identifiers: { ticker },
        logo: representations.find((r) => r.logo)?.logo ?? null,
        // Classification comes from the company's SEC-filed SIC code.
        sector: sectorForTicker(ticker),
        industry: industryForTicker(ticker),
        assetType: entries.every((entry) => entry.instrument === "ETF")
          ? "etf"
          : "stock",
        description: null,
        representations,
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export const equityRegistry = buildRegistry();
const byTicker = new Map(
  equityRegistry.map((equity) => [equity.ticker, equity]),
);
const byMint = new Map(
  equityRegistry.flatMap((equity) =>
    equity.representations.map(
      (representation) =>
        [representation.mint, { equity, representation }] as const,
    ),
  ),
);

// Universe totals are derived from a static catalog, so they are computed once
// at module load instead of re-scanning every equity on each request.
export const universeStats = (() => {
  const stats = {
    companies: equityRegistry.length,
    representations: 0,
    stocks: 0,
    etfs: 0,
    xstocks: 0,
    backpack: 0,
    ondo: 0,
    classified: 0,
  };
  for (const equity of equityRegistry) {
    stats.representations += equity.representations.length;
    if (equity.assetType === "etf") stats.etfs += 1;
    else stats.stocks += 1;
    const providers = new Set(
      equity.representations.map((representation) => representation.provider),
    );
    if (providers.has("xstocks")) stats.xstocks += 1;
    if (providers.has("backpack")) stats.backpack += 1;
    if (providers.has("ondo")) stats.ondo += 1;
    if (equity.sector) stats.classified += 1;
  }
  return stats;
})();

/** Companies per sector, ordered by size. Sectors with no companies are omitted. */
export const sectorStats = (() => {
  const counts = new Map<Sector, number>();
  for (const equity of equityRegistry) {
    if (!equity.sector) continue;
    counts.set(equity.sector, (counts.get(equity.sector) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sector, companies]) => ({ sector, companies }))
    .sort((a, b) => b.companies - a.companies);
})();

const bySector = new Map<Sector, Equity[]>();
for (const equity of equityRegistry) {
  if (!equity.sector) continue;
  bySector.set(equity.sector, [...(bySector.get(equity.sector) ?? []), equity]);
}

/**
 * Companies in a sector, most-represented first. Representation count is the
 * only ranking signal available without a live market snapshot.
 */
export function equitiesForSector(sector: Sector, limit?: number) {
  const items = [...(bySector.get(sector) ?? [])].sort(
    (a, b) =>
      b.representations.length - a.representations.length ||
      a.ticker.localeCompare(b.ticker),
  );
  return limit === undefined ? items : items.slice(0, limit);
}

/**
 * Companies carrying representations from more than one issuer. These are the
 * cases where comparing execution across issuers actually matters.
 */
export const multiIssuerStats = (() => {
  let twoIssuers = 0;
  let allIssuers = 0;
  for (const equity of equityRegistry) {
    const providers = new Set(
      equity.representations.map((representation) => representation.provider),
    );
    if (providers.size === 2) twoIssuers += 1;
    if (providers.size >= 3) allIssuers += 1;
  }
  return { twoIssuers, allIssuers, total: twoIssuers + allIssuers };
})();

export function multiIssuerEquities(limit: number) {
  return equityRegistry
    .map((equity) => ({
      equity,
      issuers: new Set(
        equity.representations.map((representation) => representation.provider),
      ).size,
    }))
    .filter((entry) => entry.issuers >= 3)
    .sort((a, b) => a.equity.ticker.localeCompare(b.equity.ticker))
    .slice(0, limit)
    .map((entry) => entry.equity);
}

export function equityForTicker(ticker: string) {
  return byTicker.get(ticker.trim().toUpperCase()) ?? null;
}

export function equityForMint(mint: string) {
  return byMint.get(mint) ?? null;
}

export function listEquities(filters?: {
  query?: string;
  assetType?: "stock" | "etf";
  provider?: EquityProvider;
  sector?: Sector;
}) {
  const query = filters?.query?.trim().toLowerCase();
  return equityRegistry.filter(
    (equity) =>
      (!query ||
        equity.ticker.toLowerCase().includes(query) ||
        equity.name.toLowerCase().includes(query)) &&
      (!filters?.assetType || equity.assetType === filters.assetType) &&
      (!filters?.sector || equity.sector === filters.sector) &&
      (!filters?.provider ||
        equity.representations.some(
          (representation) => representation.provider === filters.provider,
        )),
  );
}
