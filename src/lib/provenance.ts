/**
 * Source provenance carried by every market figure Henar shows.
 *
 * A number without its origin is a claim. Every value the new market-data
 * layer produces keeps who said it, what kind of source that is, when it was
 * read and (where the source says so) when the source itself last updated,
 * so a Pyth Pro reference, a provider mark, an on-chain state read and an
 * executable Henar route are never confused for one another.
 */
export type DataSourceType =
  | "oracle"
  | "provider-mark"
  | "provider-catalog"
  | "onchain"
  | "router-quote"
  | "dex-index"
  | "regulator"
  | "research";

export type DataFreshness = "live" | "fresh" | "carried-forward" | "stale" | "unknown";

export type DataProvenance = {
  /** Human label of the source, e.g. "Pyth Pro", "PreStocks", "Solana mainnet". */
  source: string;
  /** Machine id of the provider, e.g. "pyth", "prestocks", "tessera", "henar-router". */
  provider: string;
  sourceType: DataSourceType;
  /** When Henar read the value. */
  observedAt: string;
  /** When the source says the value was produced, if it says. */
  sourceUpdatedAt?: string | null;
  freshness?: DataFreshness;
  url?: string | null;
};

export function provenance(input: Omit<DataProvenance, "observedAt"> & { observedAt?: string }): DataProvenance {
  return { ...input, observedAt: input.observedAt ?? new Date().toISOString() };
}

export const SOURCES = {
  pyth: { source: "Pyth Pro", provider: "pyth", sourceType: "oracle" as const, url: "https://docs.pyth.network/price-feeds/pro" },
  prestocks: { source: "PreStocks", provider: "prestocks", sourceType: "provider-mark" as const, url: "https://prestocks.com/products" },
  tessera: { source: "Tessera", provider: "tessera", sourceType: "provider-mark" as const, url: "https://docs.tessera.pe" },
  onchain: { source: "Solana mainnet", provider: "solana", sourceType: "onchain" as const, url: null },
  router: { source: "Henar Router", provider: "henar-router", sourceType: "router-quote" as const, url: null },
} as const;
