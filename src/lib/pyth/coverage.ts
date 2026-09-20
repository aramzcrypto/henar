/**
 * Pyth Pro entitlement and coverage detection.
 *
 * What the current key can read is measured, not assumed: the catalog says
 * which Henar assets have a Pyth feed at all; a bounded probe against the
 * mapped feeds says which of those the key returns, on which channels, and
 * whether history is entitled. The counts are runtime facts, so expanding the
 * entitlement changes them without changing any code.
 */
import { equityRegistry } from "@/lib/equities/registry";
import { unstable_cache } from "next/cache";
import { createReadCache } from "@/lib/read-cache";
import { pythCatalog } from "./catalog";
import { PythProError, fetchLatest } from "./client";
import { PYTH_CACHE, PYTH_PRO, pythApiKey } from "./config";
import { resolveCompanyFeeds } from "./feeds";
import { pythHistory } from "./history";
import { availabilityFromError, latestReferences } from "./price";
import type { PythAvailability, PythCoverage } from "./types";

/**
 * Underlyings probed for live access.
 *
 * Probing all 897 mapped feeds would be hundreds of sequential calls, because
 * a refusal names one feed at a time. The probe is therefore a sample, and it
 * is spread evenly across the mapped universe rather than taken from the
 * front of it: an entitlement covering a handful of feeds would otherwise be
 * missed entirely and reported as covering nothing.
 */
const PROBE_COMPANIES = 60;

/**
 * Companies Henar actually demonstrates with. They go into the sample first
 * so a narrow entitlement is found rather than stepped over. This is
 * declared, not hidden: the probe reports what it tested.
 */
const PRIORITY_TICKERS = [
  "TSLA",
  "NVDA",
  "AAPL",
  "MSFT",
  "SPY",
  "QQQ",
  "COIN",
  "GOOGL",
  "AMZN",
  "META",
  "MSTR",
  "HOOD",
  "CRCL",
];

/** A sample spread across the whole list, after the priority entries. */
export function spreadSample<T extends { ticker: string }>(
  all: T[],
  size: number,
): T[] {
  const priority = all.filter((f) => PRIORITY_TICKERS.includes(f.ticker));
  const rest = all.filter((f) => !PRIORITY_TICKERS.includes(f.ticker));
  const remaining = Math.max(0, size - priority.length);
  if (rest.length <= remaining) return [...priority, ...rest];
  const step = rest.length / remaining;
  const spread = Array.from(
    { length: remaining },
    (_, i) => rest[Math.floor(i * step)],
  );
  return [...priority, ...spread];
}

/* Entitlement coverage, not a price. The probe asks Pyth about 119 feeds and
   takes over twenty seconds, so the request that arrives just after the TTL
   lapses used to wait the whole probe out. It now gets the previous snapshot
   and the refresh runs behind it. */
const cache = createReadCache<PythCoverage>(PYTH_CACHE.coverageMs, 2, {
  staleWhileRevalidate: true,
});

/**
 * The probe, behind the deployment-wide cache.
 *
 * `createReadCache` above is a Map inside one process. On serverless that
 * means every instance runs the probe itself, and the probe is the most
 * expensive read in the product: a batch that comes back partially refused
 * is retried feed by feed, which is exactly the entitlement shape it exists
 * to measure, so a miss can be well over a hundred sequential calls taking
 * more than twenty seconds. Paying that once per instance is how a page that
 * reports our own entitlement ends up rate-limited by the provider.
 *
 * `unstable_cache` is shared across instances and survives them, so the probe
 * runs once per window for the whole deployment. The in-process cache stays
 * in front of it as the hot path, and the window is the one that was already
 * in force, so freshness is unchanged.
 */
const sharedCoverage = unstable_cache(
  async (input: { now: number | null }) => measureCoverage(input.now),
  ["henar-pyth-coverage-v1"],
  { revalidate: Math.round(PYTH_CACHE.coverageMs / 1000) },
);

export async function pythCoverage(
  options: { fresh?: boolean; now?: () => number } = {},
): Promise<PythCoverage> {
  return cache(
    "coverage",
    /* A forced read, or one pinned to a supplied clock, is asking to measure
       now rather than to be told what was measured; it skips the shared
       layer. */
    options.fresh || options.now
      ? () => measureCoverage(options.now?.() ?? null)
      : () => sharedCoverage({ now: null }),
    options.fresh,
  );
}

async function measureCoverage(nowInput: number | null): Promise<PythCoverage> {
  const now = nowInput ?? Date.now();
  const generatedAt = new Date(now).toISOString();
  const key = pythApiKey();
  let catalog: Awaited<ReturnType<typeof pythCatalog>> | null = null;
  try {
    catalog = await pythCatalog();
  } catch {
    catalog = null;
  }
  const catalogBlock: PythCoverage["catalog"] = {
    totalFeeds: catalog?.entries.length ?? 0,
    equityFeeds:
      catalog?.entries.filter((e) => e.assetType === "equity").length ?? 0,
    tokenizedEquityFeeds:
      catalog?.entries.filter(
        (e) =>
          e.assetType === "crypto" &&
          /XSTOCK|ONDO TOKENIZED STOCK/i.test(e.description),
      ).length ?? 0,
    fetchedAt: catalog?.fetchedAt ?? null,
    status: catalog ? "AVAILABLE" : "UNAVAILABLE",
  };

  const byProvider: PythCoverage["coverage"]["byProvider"] = {};
  let underlyingMapped = 0;
  let tokenizedMapped = 0;
  let redemptionRatesMapped = 0;
  let representations = 0;
  const mappedUnderlying: {
    feedId: number;
    symbol: string;
    exponent: number;
    ticker: string;
  }[] = [];
  const mappedTokenized: {
    feedId: number;
    symbol: string;
    exponent: number;
    provider: string;
  }[] = [];
  if (catalog) {
    for (const equity of equityRegistry) {
      const feeds = resolveCompanyFeeds(equity, catalog);
      if (feeds.underlying) {
        underlyingMapped++;
        mappedUnderlying.push({
          feedId: feeds.underlying.feedId,
          symbol: feeds.underlying.symbol,
          exponent: feeds.underlying.exponent,
          ticker: equity.ticker,
        });
      }
      for (const rep of equity.representations) {
        representations++;
        const p = (byProvider[rep.provider] ??= {
          representations: 0,
          mapped: 0,
          accessible: null,
        });
        p.representations++;
        const m = feeds.tokenized[rep.id];
        if (m) {
          tokenizedMapped++;
          p.mapped++;
          mappedTokenized.push({
            feedId: m.feedId,
            symbol: m.symbol,
            exponent: m.exponent,
            provider: rep.provider,
          });
        }
        if (feeds.redemptionRates[rep.id]) redemptionRatesMapped++;
      }
    }
  }

  const channels: Record<string, PythAvailability> = {};
  let entitlement: PythAvailability = key ? "AVAILABLE" : "NOT_CONFIGURED";
  let detail = key
    ? ""
    : "PYTH_PRO_API_KEY is not set on this deployment; catalog coverage only";
  let history: PythAvailability = key ? "UNAVAILABLE" : "NOT_CONFIGURED";
  let probe: PythCoverage["probe"] = null;
  let underlyingAccessible: number | null = null;
  let tokenizedAccessible: number | null = null;
  let realTimeFeeds: number | null = null;

  if (key && catalog) {
    // Live probe: every mapped tokenized feed plus a bounded slice of underlyings.
    const underlyingSample = spreadSample(mappedUnderlying, PROBE_COMPANIES);
    const sample = [...mappedTokenized, ...underlyingSample];
    const result = await latestReferences(sample, { now: () => now });
    const accessible = new Set(Object.keys(result.feeds).map(Number));
    /* A key that reads some feeds is entitled, whatever it refuses. Only a
           key that reads none of the sample is reported as not entitled. */
    entitlement = accessible.size > 0 ? "AVAILABLE" : result.status;
    detail =
      accessible.size > 0
        ? `key accepted; ${accessible.size} of ${sample.length} probed feeds readable`
        : (result.error ?? "no probed feed was readable under this key");
    underlyingAccessible = underlyingSample.filter((f) =>
      accessible.has(f.feedId),
    ).length;
    tokenizedAccessible = mappedTokenized.filter((f) =>
      accessible.has(f.feedId),
    ).length;
    for (const provider of Object.keys(byProvider))
      byProvider[provider].accessible = mappedTokenized.filter(
        (f) => f.provider === provider && accessible.has(f.feedId),
      ).length;
    probe = {
      feedsProbed: sample.length,
      feedsAccessible: accessible.size,
      feedsNotEntitled: new Set(result.notEntitled).size,
      sampleSize: underlyingSample.length,
    };
    /* Channels and history are properties of the key, so they must be
           tested on a feed the key can actually read. Testing them on a
           refused feed measures the refusal instead, and reports a working
           entitlement as a missing one. */
    const readable = sample.find((f) => accessible.has(f.feedId)) ?? null;
    if (readable) {
      for (const channel of PYTH_PRO.channels) {
        try {
          await fetchLatest([readable.feedId], channel);
          channels[channel] = "AVAILABLE";
        } catch (error) {
          channels[channel] = availabilityFromError(error);
        }
      }
      realTimeFeeds = channels.real_time === "AVAILABLE" ? accessible.size : 0;
      const to = Math.floor(now / 1000);
      const h = await pythHistory({
        symbol: readable.symbol,
        resolution: "D",
        from: to - 7 * 86_400,
        to,
      });
      history = h.status === "NO_DATA" ? "AVAILABLE" : h.status;
    } else {
      history = "UNAVAILABLE";
    }
  } else if (key && !catalog) {
    entitlement = "UNAVAILABLE";
    detail = "Pyth catalog unreachable";
  }

  return {
    entitlement: {
      status: entitlement,
      keyConfigured: Boolean(key),
      detail,
      channels,
      history,
      checkedAt: generatedAt,
    },
    catalog: catalogBlock,
    coverage: {
      companies: equityRegistry.length,
      underlyingMapped,
      underlyingAccessible,
      representations,
      tokenizedMapped,
      tokenizedAccessible,
      redemptionRatesMapped,
      byProvider,
      realTimeFeeds,
      historicalFeeds:
        history === "AVAILABLE"
          ? (probe?.feedsAccessible ?? null)
          : history === "NOT_CONFIGURED"
            ? null
            : 0,
      additionalWithEntitlement: probe
        ? underlyingMapped + tokenizedMapped - probe.feedsAccessible
        : null,
    },
    probe,
    generatedAt,
  };
}

export { PythProError };
