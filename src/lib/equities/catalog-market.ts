/**
 * One live market read over the entire verified mint catalog.
 *
 * Ranked market views used to rank only the window they had fetched — fifty
 * companies in alphabetical order — and the interface had to say so. The
 * limit was never the data: Jupiter answers for a hundred mints per call, so
 * the whole catalog is about twenty-three calls, which is a single cached
 * pass rather than a per-request cost.
 *
 * That pass is the primitive here. It gives ranked views the whole universe,
 * it tells the liquid-only filter which companies actually have an on-chain
 * market, and it is the same read the issuer comparison aggregates. Nothing
 * downstream fetches a second time.
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { equityRegistry } from "./registry";

/** Jupiter's keyless token search. Rate limited, so the pass is paced and cached. */
const SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
export const JUPITER_TOKEN_API = "https://dev.jup.ag/docs/token-api";
/** Jupiter returns at most this many entries per call, whatever is asked for. */
export const BATCH_SIZE = 100;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_SECONDS = 5 * 60;
const CACHE_MS = CACHE_SECONDS * 1_000;

const statsSchema = z
  .object({
    buyVolume: z.number().nonnegative().optional(),
    sellVolume: z.number().nonnegative().optional(),
    priceChange: z.number().finite().optional(),
    numTraders: z.number().nonnegative().optional(),
  })
  .optional();

const entrySchema = z.object({
  id: z.string(),
  usdPrice: z.number().positive().optional(),
  liquidity: z.number().nonnegative().optional(),
  mcap: z.number().nonnegative().optional(),
  holderCount: z.number().nonnegative().optional(),
  stats24h: statsSchema,
});

export type TokenMarketEntry = z.infer<typeof entrySchema>;

export type CatalogMarket = {
  entries: Map<string, TokenMarketEntry>;
  observedAt: string;
  /** False when any batch failed, so totals are known to be short. */
  complete: boolean;
  batches: number;
  failedBatches: number;
};

export function parseSearchPayload(payload: unknown): TokenMarketEntry[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    const parsed = entrySchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

/** 24h traded volume is both sides of the book, and only where a side is reported. */
export function tradedVolume(entry: TokenMarketEntry | undefined): number | null {
  const stats = entry?.stats24h;
  if (!stats) return null;
  const buy = stats.buyVolume ?? null;
  const sell = stats.sellVolume ?? null;
  if (buy === null && sell === null) return null;
  return (buy ?? 0) + (sell ?? 0);
}

/**
 * One batch, served through Next's data cache rather than fetched per render.
 *
 * `createReadCache` below is a Map inside one process, so on serverless every
 * instance keeps its own and a cold one pays the whole pass. Twenty-three
 * uncached calls per instance is how a keyless Jupiter host starts answering
 * 429 under load, which it did during development. The data cache is shared
 * across instances and survives them, so the pass is paid once per window for
 * the whole deployment instead of once per instance.
 *
 * The window is the same one the in-process cache already applied, so nothing
 * about freshness changes. This is a ranking and activity snapshot, never a
 * price: execution quotes fresh and does not read it.
 */
async function readBatch(mints: string[], fetchImpl: typeof fetch): Promise<TokenMarketEntry[]> {
  const response = await fetchImpl(`${SEARCH_URL}?query=${mints.join(",")}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    next: { revalidate: CACHE_SECONDS },
  });
  if (!response.ok) throw new Error(`Jupiter token search returned ${response.status}`);
  return parseSearchPayload(await response.json());
}

/** Bounded-concurrency fan-out. A batch that fails is recorded, never retried into a stall. */
export async function readMarketEntries(
  mints: string[],
  options: { fetch?: typeof fetch; concurrency?: number } = {},
): Promise<{ entries: Map<string, TokenMarketEntry>; batches: number; failed: number }> {
  const fetchImpl = options.fetch ?? fetch;
  const batches = chunk([...new Set(mints)], BATCH_SIZE);
  const entries = new Map<string, TokenMarketEntry>();
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(options.concurrency ?? CONCURRENCY, batches.length)) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          for (const entry of await readBatch(batch, fetchImpl)) entries.set(entry.id, entry);
        } catch {
          failed += 1;
        }
      }
    }),
  );
  return { entries, batches: batches.length, failed };
}

/* Not a price. This is a universe-wide activity snapshot used for ranking and
   filtering, and a visitor arriving as the window lapses is better served the
   previous pass at once than made to wait twenty-three calls. Execution never
   reads it: /trade quotes fresh, every time. */
const cache = createReadCache<CatalogMarket>(CACHE_MS, 2, { staleWhileRevalidate: true });

export async function catalogMarket(
  options: { fetch?: typeof fetch; fresh?: boolean } = {},
): Promise<CatalogMarket> {
  const read = async () => {
      const observedAt = new Date().toISOString();
      const mints = equityRegistry.flatMap((equity) =>
        equity.representations.map((representation) => representation.mint),
      );
      const { entries, batches, failed } = await readMarketEntries(mints, { fetch: options.fetch });
      return { entries, observedAt, complete: failed === 0, batches, failedBatches: failed };
  };
  /* The cached closure captures the fetch it was created with, so a caller
     supplying its own reads directly rather than being handed another
     caller's entries. */
  if (options.fetch) return read();
  return cache("catalog", read, options.fresh);
}
