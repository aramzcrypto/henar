/**
 * Company-level Pyth bundle: verified feed mappings plus the latest
 * references for the underlying, every mapped tokenized representation and
 * their redemption rates. This is the one object Markets, Trade and the
 * Execution Guard all read, so they cannot disagree about what Pyth said.
 */
import type { Equity } from "@/lib/equities/types";
import { equityForMint, equityForTicker } from "@/lib/equities/registry";
import { henarFlag } from "@/lib/feature-flags";
import { pythCatalog } from "./catalog";
import { pythApiKey } from "./config";
import { feedIdsOf, resolveCompanyFeeds } from "./feeds";
import { assessFairValue } from "./fair-value";
import { latestReferences } from "./price";
import type { FairValueAssessment, PythAvailability, PythCompanyFeeds, PythReference } from "./types";

export type RepresentationPyth = {
  representationId: string;
  provider: string;
  tokenSymbol: string;
  mint: string;
  availability: PythAvailability;
  feed: PythCompanyFeeds["tokenized"][string] | null;
  reference: PythReference | null;
  redemptionRate: PythReference | null;
  redemptionRateFeed: PythCompanyFeeds["redemptionRates"][string] | null;
  unmappedReason: string | null;
  /** Assessment without an executable price (basis only). */
  assessment: FairValueAssessment;
};

export type CompanyPyth = {
  enabled: boolean;
  ticker: string;
  equityId: string;
  status: PythAvailability;
  detail: string | null;
  underlying: { feed: PythCompanyFeeds["underlying"]; reference: PythReference | null; availability: PythAvailability };
  representations: RepresentationPyth[];
  observedAt: string;
};

function availabilityFor(feed: { state: string } | null, ref: PythReference | null, result: { status: PythAvailability; notEntitled: number[] }, feedId: number | null): PythAvailability {
  if (!feed) return "UNAVAILABLE";
  if (ref) return ref.freshness === "stale" ? "STALE" : "AVAILABLE";
  if (feedId !== null && result.notEntitled.includes(feedId)) return "NOT_ENTITLED";
  if (result.status === "NOT_CONFIGURED" || result.status === "INVALID" || result.status === "UNAVAILABLE") return result.status;
  return feed.state === "stable" ? (result.status === "NOT_ENTITLED" ? "NOT_ENTITLED" : "UNAVAILABLE") : "CATALOG_ONLY";
}

export async function companyPyth(equity: Equity, options: { now?: () => number } = {}): Promise<CompanyPyth> {
  const now = options.now?.() ?? Date.now();
  const observedAt = new Date(now).toISOString();
  const base = { ticker: equity.ticker, equityId: equity.id, observedAt };
  if (!henarFlag("pythPro"))
    return { ...base, enabled: false, status: "UNAVAILABLE", detail: "HENAR_PYTH_PRO is off", underlying: { feed: null, reference: null, availability: "UNAVAILABLE" }, representations: [] };
  let feeds: PythCompanyFeeds;
  try {
    feeds = resolveCompanyFeeds(equity, await pythCatalog());
  } catch (error) {
    return { ...base, enabled: true, status: "UNAVAILABLE", detail: `Pyth catalog unavailable: ${(error as Error).message}`, underlying: { feed: null, reference: null, availability: "UNAVAILABLE" }, representations: [] };
  }
  const ids = feedIdsOf(feeds);
  const catalog = await pythCatalog();
  const metas = ids.map((id) => catalog.byId.get(id)!).filter(Boolean).map((e) => ({ feedId: e.feedId, symbol: e.symbol, exponent: e.exponent }));
  const result = pythApiKey()
    ? await latestReferences(metas, { now: () => now })
    : { status: "NOT_CONFIGURED" as const, feeds: {}, notEntitled: [], error: "PYTH_PRO_API_KEY is not configured", observedAt };
  const underlyingRef = feeds.underlying ? (result.feeds[feeds.underlying.feedId] ?? null) : null;
  const representations = equity.representations.map((rep): RepresentationPyth => {
    const feed = feeds.tokenized[rep.id] ?? null;
    const rrFeed = feeds.redemptionRates[rep.id] ?? null;
    const reference = feed ? (result.feeds[feed.feedId] ?? null) : null;
    const redemptionRate = rrFeed ? (result.feeds[rrFeed.feedId] ?? null) : null;
    return {
      representationId: rep.id,
      provider: rep.provider,
      tokenSymbol: rep.tokenSymbol,
      mint: rep.mint,
      availability: availabilityFor(feed, reference, result, feed?.feedId ?? null),
      feed,
      reference,
      redemptionRate,
      redemptionRateFeed: rrFeed,
      unmappedReason: feeds.unmapped.find((u) => u.representationId === rep.id)?.reason ?? null,
      assessment: assessFairValue({ representationId: rep.id, underlying: underlyingRef, token: reference, redemptionRate, executable: null, now }),
    };
  });
  return {
    ...base,
    enabled: true,
    status: result.status,
    detail: result.error,
    underlying: { feed: feeds.underlying, reference: underlyingRef, availability: availabilityFor(feeds.underlying, underlyingRef, result, feeds.underlying?.feedId ?? null) },
    representations,
  };
}

/**
 * Fair value for one representation mint given the price a route just
 * quoted (USDC per display unit). Used by the estimate route and the guard
 * wiring; cheap because references are cached for a couple of seconds.
 */
export async function fairValueForMint(mint: string, executable: FairValueAssessment["executableRoutePrice"], options: { now?: () => number } = {}): Promise<FairValueAssessment | null> {
  const found = equityForMint(mint);
  if (!found) return null;
  const company = await companyPyth(found.equity, options);
  const row = company.representations.find((r) => r.representationId === found.representation.id);
  if (!row || !company.enabled) return null;
  return assessFairValue({ representationId: row.representationId, underlying: company.underlying.reference, token: row.reference, redemptionRate: row.redemptionRate, executable, now: options.now?.() });
}

export async function companyPythForTicker(ticker: string, options: { now?: () => number } = {}) {
  const equity = equityForTicker(ticker);
  return equity ? companyPyth(equity, options) : null;
}
