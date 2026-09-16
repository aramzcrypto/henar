import type { DataProvenance } from "@/lib/provenance";
import type { PythChannel } from "./config";

/**
 * Verified fields of the Pyth symbology / reference data API
 * (`GET https://pyth.dourolabs.app/v1/symbols`). Only fields observed in the
 * live response are modelled; anything else stays out.
 */
export type PythCatalogEntry = {
  feedId: number;
  name: string;
  symbol: string;
  description: string;
  assetType: string;
  instrumentType: string | null;
  exponent: number;
  minChannel: string | null;
  state: "stable" | "coming_soon" | "inactive" | string;
  hermesId: string | null;
  quoteCurrency: string | null;
  /** Session names Pyth schedules for this feed, e.g. regular/pre_market/post_market/over_night. */
  sessions: string[];
  schedule: string | null;
};

export type PythMarketSession = "regular" | "preMarket" | "postMarket" | "overNight" | "closed";

/**
 * Availability of one feed for the current Henar key.
 *  AVAILABLE      catalog has it, key returned a price.
 *  CATALOG_ONLY   catalog has it, but it is coming soon / not yet accessible without a probe.
 *  NOT_ENTITLED   catalog has it, key was refused (403).
 *  STALE          key returned a price whose feed timestamp is beyond the stale window.
 *  UNAVAILABLE    no catalog feed, Pyth unreachable, or malformed response.
 *  INVALID        key rejected (401).
 *  NOT_CONFIGURED no key on this deployment.
 */
export type PythAvailability =
  | "AVAILABLE"
  | "CATALOG_ONLY"
  | "NOT_ENTITLED"
  | "STALE"
  | "UNAVAILABLE"
  | "INVALID"
  | "NOT_CONFIGURED";

export type PythFeedRole = "underlying" | "tokenized" | "redemption-rate";

/** A verified Henar ↔ Pyth mapping with the evidence that established it. */
export type PythFeedMapping = {
  role: PythFeedRole;
  feedId: number;
  symbol: string;
  hermesId: string | null;
  assetType: string;
  state: string;
  minChannel: string | null;
  exponent: number;
  /** Which Henar object this feed is bound to. */
  representationId: string | null;
  provider: string | null;
  /** Independent facts that link the two sides; never ticker similarity alone. */
  evidence: string[];
  provenance: DataProvenance;
};

export type PythCompanyFeeds = {
  ticker: string;
  equityId: string;
  underlying: PythFeedMapping | null;
  /** Keyed by representation id. Backpack has no Pyth feeds today. */
  tokenized: Record<string, PythFeedMapping>;
  /** Pyth-published token/underlying redemption rates, keyed by representation id. */
  redemptionRates: Record<string, PythFeedMapping>;
  /** Representations for which the catalog holds nothing. */
  unmapped: { representationId: string; provider: string; reason: string }[];
};

export type PythFreshness = "live" | "carried-forward" | "stale" | "unknown";

/** One normalized latest-price observation. */
export type PythReference = {
  feedId: number;
  symbol: string;
  /** Decimal string in the feed's quote currency (USD for every mapped feed). */
  price: string;
  exponent: number;
  confidence: string | null;
  /** confidence / price, in basis points. */
  confidenceBps: number | null;
  emaPrice: string | null;
  emaConfidenceBps: number | null;
  publisherCount: number | null;
  marketSession: PythMarketSession | null;
  feedUpdateTimestampUs: string | null;
  feedUpdatedAt: string | null;
  observedAt: string;
  channel: PythChannel;
  freshness: PythFreshness;
  ageMs: number | null;
  provenance: DataProvenance;
};

export type PythLatestResult = {
  status: PythAvailability;
  /** Keyed by feed id. Feeds the response did not carry are absent. */
  feeds: Record<number, PythReference>;
  /** Feed ids the server named as not entitled, when it did. */
  notEntitled: number[];
  error: string | null;
  observedAt: string;
};

export type PythCandle = { t: number; o: string; h: string; l: string; c: string; v: string | null };

export type PythHistoryResult = {
  status: PythAvailability | "NO_DATA";
  symbol: string;
  resolution: string;
  from: number;
  to: number;
  candles: PythCandle[];
  error: string | null;
  provenance: DataProvenance;
};

export type FairValueStatus =
  | "OK"
  | "WARNING"
  | "STALE"
  | "LOW_DATA_QUALITY"
  | "EXECUTION_DEVIATION"
  | "COMPARABILITY_UNVERIFIED"
  | "REFERENCE_UNAVAILABLE";

export type Comparability =
  /** Pyth publishes a token/underlying redemption rate; used as the conversion. */
  | "redemption-rate"
  /** No verified conversion between one token and one share: basis not computed. */
  | "unverified";

export type FairValueAssessment = {
  status: FairValueStatus;
  representationId: string;
  underlyingReference: PythReference | null;
  tokenReference: PythReference | null;
  redemptionRate: PythReference | null;
  /** USDC per one display unit of the token, from the Henar route that was quoted. */
  executableRoutePrice: { price: string; side: "buy" | "sell"; source: string; quotedAt: string } | null;
  /** tokenReference / (underlyingReference × redemption rate) − 1, in bps. */
  tokenVsUnderlyingBps: number | null;
  /** executableRoutePrice / tokenReference − 1, in bps. */
  routeVsTokenBps: number | null;
  /** Which reference is the execution boundary: the tokenized market when it is fresh, else nothing. */
  executionReference: "tokenized" | "underlying" | null;
  comparability: Comparability;
  underlyingMarketSession: PythMarketSession | null;
  underlyingFreshness: PythFreshness | null;
  tokenFreshness: PythFreshness | null;
  confidenceBps: number | null;
  publisherCount: number | null;
  assessedAt: string;
  reasons: string[];
};

export type PythGuardState =
  | "PYTH_PASS"
  | "PYTH_WARNING"
  | "PYTH_REFERENCE_UNAVAILABLE"
  | "PYTH_STALE"
  | "PYTH_LOW_DATA_QUALITY"
  | "PYTH_EXECUTION_DEVIATION"
  | "PYTH_COMPARABILITY_UNVERIFIED";

export type PythCoverage = {
  entitlement: {
    status: PythAvailability;
    keyConfigured: boolean;
    detail: string;
    channels: Record<string, PythAvailability>;
    history: PythAvailability;
    checkedAt: string;
  };
  catalog: {
    totalFeeds: number;
    equityFeeds: number;
    tokenizedEquityFeeds: number;
    fetchedAt: string | null;
    status: "AVAILABLE" | "UNAVAILABLE";
  };
  coverage: {
    companies: number;
    underlyingMapped: number;
    underlyingAccessible: number | null;
    representations: number;
    tokenizedMapped: number;
    tokenizedAccessible: number | null;
    redemptionRatesMapped: number;
    byProvider: Record<string, { representations: number; mapped: number; accessible: number | null }>;
    realTimeFeeds: number | null;
    historicalFeeds: number | null;
    /** Feeds in the Pyth catalog that map to Henar assets but the key cannot read. */
    additionalWithEntitlement: number | null;
  };
  probe: {
    feedsProbed: number;
    feedsAccessible: number;
    feedsNotEntitled: number;
    sampleSize: number;
  } | null;
  generatedAt: string;
};
