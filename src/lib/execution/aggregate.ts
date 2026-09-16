import { quoteJupiter } from "./adapters/jupiter";
import { quoteRaydium } from "./adapters/raydium";
import { quoteOpenOcean } from "./adapters/openocean";
import { quoteTitan } from "./adapters/titan";
import { available, sourceReason, unavailable } from "./shared";
import type {
  AggregatedExecutionQuote,
  ExecutionQuoteRequest,
  ExecutionSource,
  SourceExecutionQuote,
} from "./types";

const adapters: Array<
  [
    ExecutionSource,
    (request: ExecutionQuoteRequest) => Promise<SourceExecutionQuote>,
  ]
> = [
  ["jupiter", quoteJupiter],
  ["raydium", quoteRaydium],
  ["openocean", quoteOpenOcean],
  ["titan", quoteTitan],
];

const indicativeSources = new Set<ExecutionSource>([
  "jupiter",
  "raydium",
  "openocean",
  "titan",
]);
const INDICATIVE_CACHE_MS = 5_000;
const indicativeCache = new Map<
  string,
  { expiresAt: number; promise: Promise<AggregatedExecutionQuote> }
>();

function indicativeKey(request: ExecutionQuoteRequest) {
  return `${request.inputMint}:${request.outputMint}:${request.amount}:${request.slippageBps}`;
}

/** Exported for tests: the selection rule is the part worth pinning down. */
export async function aggregateWithAdapters(
  request: ExecutionQuoteRequest,
  selected: typeof adapters,
  timeoutMs?: number,
): Promise<AggregatedExecutionQuote> {
  const tasks = selected.map(([, adapter]) => adapter(request));
  const bounded = timeoutMs
    ? tasks.map((task) =>
        new Promise<SourceExecutionQuote>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Quote source timed out.")),
            timeoutMs,
          );
          task.then(
            (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            },
          );
        }),
      )
    : tasks;
  const settled = await Promise.allSettled(bounded);
  const sources = settled.map((result, index) => {
    const source = selected[index][0];
    return result.status === "fulfilled"
      ? available(result.value)
      : unavailable(source, sourceReason(result.reason));
  });
  const candidates = sources
    .flatMap((result) => (result.status === "available" ? [result.quote] : []))
    .sort((a, b) => {
      const output = BigInt(b.outputAmount) - BigInt(a.outputAmount);
      if (output !== 0n) return output > 0n ? 1 : -1;
      const minimum =
        BigInt(b.minimumOutputAmount) - BigInt(a.minimumOutputAmount);
      return minimum === 0n
        ? a.source.localeCompare(b.source)
        : minimum > 0n
          ? 1
          : -1;
    });
  const quotedAt = new Date().toISOString();
  /* The headline is the best quote Henar can actually fill, not the best
     quote it can see. Every market swap is built through Jupiter; OpenOcean
     and Titan quote only. Ranking on output alone put their numbers on the
     ticket's Receive line, promising the user an amount the order could never
     produce. Non-fillable sources stay in `candidates` and are still shown,
     because "another venue is 12 bps better" is worth knowing — it just is
     not a promise. */
  const fillable = candidates.filter((quote) => quote.fillable);
  return {
    selected: fillable[0] ?? null,
    candidates,
    sources,
    quotedAt,
    expiresAt: candidates.length
      ? candidates.reduce(
          (earliest, quote) =>
            quote.expiresAt < earliest ? quote.expiresAt : earliest,
          candidates[0].expiresAt,
        )
      : null,
  };
}

export async function aggregateExecutionQuotes(
  request: ExecutionQuoteRequest,
): Promise<AggregatedExecutionQuote> {
  return aggregateWithAdapters(request, adapters);
}

export async function aggregateIndicativeQuotes(
  request: ExecutionQuoteRequest,
): Promise<AggregatedExecutionQuote> {
  const key = indicativeKey(request);
  const now = Date.now();
  const cached = indicativeCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = aggregateWithAdapters(
    request,
    adapters.filter(([source]) => indicativeSources.has(source)),
    1_500,
  );
  indicativeCache.set(key, { expiresAt: now + INDICATIVE_CACHE_MS, promise });
  if (indicativeCache.size > 2_000)
    for (const [cacheKey, entry] of indicativeCache)
      if (entry.expiresAt <= now) indicativeCache.delete(cacheKey);
  try {
    const result = await promise;
    if (!result.selected) indicativeCache.delete(key);
    return result;
  } catch (error) {
    indicativeCache.delete(key);
    throw error;
  }
}
