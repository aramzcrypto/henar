/**
 * Latest-price normalization and short-lived caching.
 *
 * Pyth carries the most recent price forward when a market is not producing
 * new prices, so freshness is read from `feedUpdateTimestamp`, never from
 * the mere presence of a price in the response.
 */
import { createReadCache } from "@/lib/read-cache";
import { provenance, SOURCES } from "@/lib/provenance";
import { fetchLatest, PythProError, type PythClientOptions, type PythParsedFeed } from "./client";
import { PYTH_CACHE, PYTH_PRO, PYTH_QUALITY, type PythChannel } from "./config";
import { parseDecimal, ratioBps, scaleMantissa } from "./decimal-math";
import type { PythAvailability, PythFreshness, PythLatestResult, PythReference } from "./types";

export function freshnessOf(ageMs: number | null, session: PythReference["marketSession"]): PythFreshness {
  if (ageMs === null) return "unknown";
  if (ageMs <= PYTH_QUALITY.liveWithinMs) return "live";
  if (ageMs <= PYTH_QUALITY.staleAfterMs) return "carried-forward";
  // A closed equity market legitimately carries its last print for hours;
  // that is still "carried forward", not a broken feed.
  if (session && session !== "regular") return "carried-forward";
  return "stale";
}

/** Pure normalization of one parsed feed. Null when it carries no price. */
export function normalizeReference(
  feed: PythParsedFeed,
  symbol: string,
  catalogExponent: number,
  channel: PythChannel,
  observedAtMs: number,
): PythReference | null {
  if (feed.price === null || feed.price === undefined) return null;
  const exponent = feed.exponent ?? catalogExponent;
  const price = scaleMantissa(String(feed.price), exponent);
  const priceR = parseDecimal(price);
  if (!priceR || priceR.num <= 0n) return null;
  const confidence = feed.confidence === null || feed.confidence === undefined ? null : scaleMantissa(String(feed.confidence), exponent);
  const confR = parseDecimal(confidence ?? undefined);
  const emaPrice = feed.emaPrice === null || feed.emaPrice === undefined ? null : scaleMantissa(String(feed.emaPrice), exponent);
  const emaConf = feed.emaConfidence === null || feed.emaConfidence === undefined ? null : parseDecimal(scaleMantissa(String(feed.emaConfidence), exponent));
  const updateUs = feed.feedUpdateTimestamp === null || feed.feedUpdateTimestamp === undefined ? null : String(feed.feedUpdateTimestamp);
  const updatedMs = updateUs === null ? null : Number(BigInt(updateUs) / 1000n);
  const ageMs = updatedMs === null ? null : Math.max(0, observedAtMs - updatedMs);
  const session = feed.marketSession ?? null;
  const observedAt = new Date(observedAtMs).toISOString();
  const freshness = freshnessOf(ageMs, session);
  return {
    feedId: feed.priceFeedId,
    symbol,
    price,
    exponent,
    confidence,
    confidenceBps: confR ? ratioBps(confR, priceR) : null,
    emaPrice,
    emaConfidenceBps: emaConf ? ratioBps(emaConf, priceR) : null,
    publisherCount: feed.publisherCount ?? null,
    marketSession: session,
    feedUpdateTimestampUs: updateUs,
    feedUpdatedAt: updatedMs === null ? null : new Date(updatedMs).toISOString(),
    observedAt,
    channel,
    freshness,
    ageMs,
    provenance: provenance({ ...SOURCES.pyth, observedAt, sourceUpdatedAt: updatedMs === null ? null : new Date(updatedMs).toISOString(), freshness: freshness === "live" ? "live" : freshness === "unknown" ? "unknown" : freshness }),
  };
}

export function availabilityFromError(error: unknown): PythAvailability {
  if (error instanceof PythProError) {
    switch (error.kind) {
      case "MISSING_KEY":
        return "NOT_CONFIGURED";
      case "INVALID_KEY":
        return "INVALID";
      case "NOT_ENTITLED":
        return "NOT_ENTITLED";
      default:
        return "UNAVAILABLE";
    }
  }
  return "UNAVAILABLE";
}

const cache = createReadCache<PythLatestResult>(PYTH_CACHE.latestMs, 256);

export type LatestOptions = PythClientOptions & { channel?: PythChannel; now?: () => number };

/**
 * Latest references for a set of feeds. Results are cached for a couple of
 * seconds per feed set; every reference keeps the feed's own timestamp.
 */
export async function latestReferences(
  feeds: { feedId: number; symbol: string; exponent: number }[],
  options: LatestOptions = {},
): Promise<PythLatestResult> {
  const channel = options.channel ?? PYTH_PRO.defaultChannel;
  const ids = [...new Set(feeds.map((f) => f.feedId))].sort((a, b) => a - b);
  const key = `${channel}:${ids.join(",")}`;
  const read = async (): Promise<PythLatestResult> => {
    const now = options.now?.() ?? Date.now();
    const observedAt = new Date(now).toISOString();
    const result: PythLatestResult = { status: "AVAILABLE", feeds: {}, notEntitled: [], error: null, observedAt };
    if (!ids.length) return result;
    const bySymbol = new Map(feeds.map((f) => [f.feedId, f]));
    for (let i = 0; i < ids.length; i += PYTH_PRO.batchSize) {
      const slice = ids.slice(i, i + PYTH_PRO.batchSize);
      try {
        const { feeds: parsed } = await fetchLatest(slice, channel, options);
        for (const feed of parsed) {
          const meta = bySymbol.get(feed.priceFeedId);
          if (!meta) continue;
          const ref = normalizeReference(feed, meta.symbol, meta.exponent, channel, now);
          if (ref) result.feeds[feed.priceFeedId] = ref;
        }
      } catch (error) {
        const status = availabilityFromError(error);
        if (error instanceof PythProError && error.kind === "NOT_ENTITLED") {
          result.notEntitled.push(...(error.feedIds.length ? error.feedIds : slice));
          /* One refused feed fails the whole batch. Retry the rest one by
             one so an entitled feed is not lost to an unentitled neighbour;
             bounded by the batch size, and only on a partial refusal. */
          const refused = new Set(error.feedIds);
          if (error.feedIds.length && error.feedIds.length < slice.length) {
            for (const id of slice.filter((x) => !refused.has(x))) {
              try {
                const { feeds: parsed } = await fetchLatest([id], channel, options);
                const meta = bySymbol.get(id);
                const ref = parsed[0] && meta ? normalizeReference(parsed[0], meta.symbol, meta.exponent, channel, now) : null;
                if (ref) result.feeds[id] = ref;
              } catch (inner) {
                if (inner instanceof PythProError && inner.kind === "NOT_ENTITLED") result.notEntitled.push(id);
                else {
                  result.status = availabilityFromError(inner);
                  result.error = (inner as Error).message;
                }
              }
            }
          }
          if (result.status === "AVAILABLE") result.status = Object.keys(result.feeds).length ? "AVAILABLE" : "NOT_ENTITLED";
        } else {
          result.status = status;
          result.error = (error as Error).message;
          break;
        }
      }
    }
    const refs = Object.values(result.feeds);
    if (result.status === "AVAILABLE" && refs.length && refs.every((r) => r.freshness === "stale")) result.status = "STALE";
    return result;
  };
  // Failures are not cached: a transient outage must not pin an error for the window.
  const value = await cache(key, read);
  if (value.status !== "AVAILABLE" && value.status !== "STALE" && value.status !== "NOT_ENTITLED") return read();
  return value;
}
