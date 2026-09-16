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
import { createReadCache } from "@/lib/read-cache";
import { pythCatalog } from "./catalog";
import { PythProError, fetchLatest } from "./client";
import { PYTH_CACHE, PYTH_PRO, pythApiKey } from "./config";
import { resolveCompanyFeeds } from "./feeds";
import { pythHistory } from "./history";
import { availabilityFromError, latestReferences } from "./price";
import type { PythAvailability, PythCoverage } from "./types";

/** Companies probed for live access, largest catalog presence first. */
const PROBE_COMPANIES = 60;

const cache = createReadCache<PythCoverage>(PYTH_CACHE.coverageMs, 2);

export async function pythCoverage(options: { fresh?: boolean; now?: () => number } = {}): Promise<PythCoverage> {
  return cache(
    "coverage",
    async () => {
      const now = options.now?.() ?? Date.now();
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
        equityFeeds: catalog?.entries.filter((e) => e.assetType === "equity").length ?? 0,
        tokenizedEquityFeeds: catalog?.entries.filter((e) => e.assetType === "crypto" && /XSTOCK|ONDO TOKENIZED STOCK/i.test(e.description)).length ?? 0,
        fetchedAt: catalog?.fetchedAt ?? null,
        status: catalog ? "AVAILABLE" : "UNAVAILABLE",
      };

      const byProvider: PythCoverage["coverage"]["byProvider"] = {};
      let underlyingMapped = 0;
      let tokenizedMapped = 0;
      let redemptionRatesMapped = 0;
      let representations = 0;
      const mappedUnderlying: { feedId: number; symbol: string; exponent: number; ticker: string }[] = [];
      const mappedTokenized: { feedId: number; symbol: string; exponent: number; provider: string }[] = [];
      if (catalog) {
        for (const equity of equityRegistry) {
          const feeds = resolveCompanyFeeds(equity, catalog);
          if (feeds.underlying) {
            underlyingMapped++;
            mappedUnderlying.push({ feedId: feeds.underlying.feedId, symbol: feeds.underlying.symbol, exponent: feeds.underlying.exponent, ticker: equity.ticker });
          }
          for (const rep of equity.representations) {
            representations++;
            const p = (byProvider[rep.provider] ??= { representations: 0, mapped: 0, accessible: null });
            p.representations++;
            const m = feeds.tokenized[rep.id];
            if (m) {
              tokenizedMapped++;
              p.mapped++;
              mappedTokenized.push({ feedId: m.feedId, symbol: m.symbol, exponent: m.exponent, provider: rep.provider });
            }
            if (feeds.redemptionRates[rep.id]) redemptionRatesMapped++;
          }
        }
      }

      const channels: Record<string, PythAvailability> = {};
      let entitlement: PythAvailability = key ? "AVAILABLE" : "NOT_CONFIGURED";
      let detail = key ? "" : "PYTH_PRO_API_KEY is not set on this deployment; catalog coverage only";
      let history: PythAvailability = key ? "UNAVAILABLE" : "NOT_CONFIGURED";
      let probe: PythCoverage["probe"] = null;
      let underlyingAccessible: number | null = null;
      let tokenizedAccessible: number | null = null;
      let realTimeFeeds: number | null = null;

      if (key && catalog) {
        // Live probe: every mapped tokenized feed plus a bounded slice of underlyings.
        const sample = [...mappedTokenized, ...mappedUnderlying.slice(0, PROBE_COMPANIES)];
        const result = await latestReferences(sample, { now: () => now });
        entitlement = result.status;
        detail = result.error ?? (result.status === "AVAILABLE" ? "key accepted; entitlement measured per feed" : result.status);
        const accessible = new Set(Object.keys(result.feeds).map(Number));
        underlyingAccessible = mappedUnderlying.slice(0, PROBE_COMPANIES).filter((f) => accessible.has(f.feedId)).length;
        tokenizedAccessible = mappedTokenized.filter((f) => accessible.has(f.feedId)).length;
        for (const provider of Object.keys(byProvider))
          byProvider[provider].accessible = mappedTokenized.filter((f) => f.provider === provider && accessible.has(f.feedId)).length;
        probe = { feedsProbed: sample.length, feedsAccessible: accessible.size, feedsNotEntitled: new Set(result.notEntitled).size, sampleSize: PROBE_COMPANIES };
        // Channel entitlement on one accessible feed, when there is one.
        const first = sample.find((f) => accessible.has(f.feedId)) ?? sample[0];
        if (first) {
          for (const channel of PYTH_PRO.channels) {
            try {
              await fetchLatest([first.feedId], channel);
              channels[channel] = "AVAILABLE";
            } catch (error) {
              channels[channel] = availabilityFromError(error);
            }
          }
          realTimeFeeds = channels.real_time === "AVAILABLE" ? accessible.size : 0;
          const to = Math.floor(now / 1000);
          const h = await pythHistory({ symbol: first.symbol, resolution: "D", from: to - 7 * 86_400, to });
          history = h.status === "NO_DATA" ? "AVAILABLE" : h.status;
        }
      } else if (key && !catalog) {
        entitlement = "UNAVAILABLE";
        detail = "Pyth catalog unreachable";
      }

      return {
        entitlement: { status: entitlement, keyConfigured: Boolean(key), detail, channels, history, checkedAt: generatedAt },
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
          historicalFeeds: history === "AVAILABLE" ? (probe?.feedsAccessible ?? null) : history === "NOT_CONFIGURED" ? null : 0,
          additionalWithEntitlement: probe ? underlyingMapped + tokenizedMapped - probe.feedsAccessible : null,
        },
        probe,
        generatedAt,
      };
    },
    options.fresh,
  );
}

export { PythProError };
