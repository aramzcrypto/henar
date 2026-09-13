import rawCatalog from "@/data/stocks.json";
import { adaptBackpack } from "./providers/backpack";
import type { CatalogEntry } from "./providers/common";
import { adaptOndo } from "./providers/ondo";
import { adaptXStocks } from "./providers/xstocks";
import type { Equity, EquityProvider, Representation } from "./types";

const catalog = rawCatalog as CatalogEntry[];
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
        sector: null,
        industry: null,
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
}) {
  const query = filters?.query?.trim().toLowerCase();
  return equityRegistry.filter(
    (equity) =>
      (!query ||
        equity.ticker.toLowerCase().includes(query) ||
        equity.name.toLowerCase().includes(query)) &&
      (!filters?.assetType || equity.assetType === filters.assetType) &&
      (!filters?.provider ||
        equity.representations.some(
          (representation) => representation.provider === filters.provider,
        )),
  );
}
