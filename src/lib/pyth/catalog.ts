/**
 * Pyth Pro catalog (symbology / reference data).
 *
 * The catalog endpoint is public and large (~3,700 feeds). It is read once
 * per hour, validated field by field, and indexed by symbol and by feed id.
 * Nothing is inferred from it beyond what it states: a feed exists, with a
 * symbol, an asset type, a state and a minimum channel.
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { PYTH_CACHE, PYTH_PRO } from "./config";
import type { PythCatalogEntry } from "./types";

const entrySchema = z.object({
  pyth_lazer_id: z.number().int().nonnegative(),
  name: z.string(),
  symbol: z.string().min(1),
  description: z.string().nullish(),
  asset_type: z.string(),
  instrument_type: z.string().nullish(),
  exponent: z.number().int(),
  min_channel: z.string().nullish(),
  state: z.string(),
  hermes_id: z.string().nullish(),
  quote_currency: z.string().nullish(),
  market_sessions: z.record(z.unknown()).nullish(),
  schedule: z.string().nullish(),
});

export type PythCatalogIndex = {
  entries: PythCatalogEntry[];
  bySymbol: Map<string, PythCatalogEntry>;
  byId: Map<number, PythCatalogEntry>;
  fetchedAt: string;
};

export function catalogEntryFrom(raw: unknown): PythCatalogEntry | null {
  const parsed = entrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  return {
    feedId: e.pyth_lazer_id,
    name: e.name,
    symbol: e.symbol,
    description: e.description ?? "",
    assetType: e.asset_type,
    instrumentType: e.instrument_type ?? null,
    exponent: e.exponent,
    minChannel: e.min_channel ?? null,
    state: e.state,
    hermesId: e.hermes_id ?? null,
    quoteCurrency: e.quote_currency ?? null,
    sessions: e.market_sessions ? Object.keys(e.market_sessions) : [],
    schedule: e.schedule ?? null,
  };
}

export function indexCatalog(entries: PythCatalogEntry[], fetchedAt = new Date().toISOString()): PythCatalogIndex {
  const bySymbol = new Map<string, PythCatalogEntry>();
  const byId = new Map<number, PythCatalogEntry>();
  for (const entry of entries) {
    // Symbols are unique in the live catalog; a duplicate would make the
    // mapping ambiguous, so the first occurrence wins and the rest are dropped.
    if (!bySymbol.has(entry.symbol.toUpperCase())) bySymbol.set(entry.symbol.toUpperCase(), entry);
    byId.set(entry.feedId, entry);
  }
  return { entries, bySymbol, byId, fetchedAt };
}

/** Parse a raw catalog payload; malformed rows are dropped, not repaired. */
export function catalogFromPayload(payload: unknown, fetchedAt?: string): PythCatalogIndex {
  const rows = z.array(z.unknown()).parse(payload);
  return indexCatalog(rows.map(catalogEntryFrom).filter((e): e is PythCatalogEntry => e !== null), fetchedAt);
}

const cache = createReadCache<PythCatalogIndex>(PYTH_CACHE.catalogMs, 4);

export async function pythCatalog(options: { fetch?: typeof fetch } = {}): Promise<PythCatalogIndex> {
  return cache("catalog", async () => {
    const doFetch = options.fetch ?? fetch;
    const response = await doFetch(PYTH_PRO.symbolsUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PYTH_PRO.requestTimeoutMs * 3),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Pyth catalog unavailable (status ${response.status}).`);
    return catalogFromPayload(await response.json());
  });
}
