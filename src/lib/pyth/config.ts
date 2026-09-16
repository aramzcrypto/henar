/**
 * Pyth Pro configuration. Endpoints, cache windows and every quality or
 * deviation threshold the Pyth layer and the Execution Guard use live here,
 * so nothing arbitrary is scattered through the code.
 *
 * Sources (read 16 September 2026):
 *   https://docs.pyth.network/price-feeds/pro/api/rest
 *   https://docs.pyth.network/price-feeds/pro/api/history
 *   https://docs.pyth.network/price-feeds/pro/price-feed-ids
 *   https://docs.pyth.network/price-feeds/pro/payload-reference
 */
export const PYTH_PRO = {
  /** Public symbology / reference data. No key needed. */
  symbolsUrl: "https://pyth.dourolabs.app/v1/symbols",
  /** REST router: POST /v1/latest_price, POST /v1/price. Bearer key. */
  restBaseUrl: "https://pyth-lazer.dourolabs.app",
  /** History: GET /v1/{channel}/history. Bearer key. */
  historyBaseUrl: "https://pyth.dourolabs.app/v1",
  wsUrls: [
    "wss://pyth-lazer-0.dourolabs.app/v1/stream",
    "wss://pyth-lazer-1.dourolabs.app/v1/stream",
    "wss://pyth-lazer-2.dourolabs.app/v1/stream",
  ],
  /** Channel Henar asks for by default; the catalog's `min_channel` may be slower. */
  defaultChannel: "fixed_rate@200ms",
  channels: ["real_time", "fixed_rate@50ms", "fixed_rate@200ms", "fixed_rate@1000ms"] as const,
  /** Properties requested on every latest-price call. */
  properties: ["price", "exponent", "confidence", "emaPrice", "emaConfidence", "publisherCount", "marketSession", "feedUpdateTimestamp"] as const,
  historyResolutions: ["1", "2", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"] as const,
  requestTimeoutMs: 6_000,
  /** Feed ids per latest-price request. */
  batchSize: 50,
  docsUrl: "https://docs.pyth.network/price-feeds/pro",
  terminalUrl: "https://docs.pyth.network/price-feeds/pro/acquire-api-key",
} as const;

export type PythChannel = (typeof PYTH_PRO.channels)[number];
export type PythHistoryResolution = (typeof PYTH_PRO.historyResolutions)[number];

export const PYTH_CACHE = {
  catalogMs: 60 * 60_000,
  entitlementMs: 10 * 60_000,
  latestMs: 2_000,
  historyMs: 60_000,
  coverageMs: 10 * 60_000,
} as const;

/**
 * Data-quality thresholds. Confidence is a price-uncertainty input, never a
 * volatility estimate; the ratio is the feed's confidence interval relative
 * to its price.
 */
export const PYTH_QUALITY = {
  /** A feed update newer than this is "live". */
  liveWithinMs: 30_000,
  /** Older than this the reference is stale for execution purposes. */
  staleAfterMs: 5 * 60_000,
  minPublisherCount: 3,
  /** confidence / price above this is low quality. */
  maxConfidenceBps: 100,
} as const;

/** Fair-value / execution-deviation thresholds (basis points). */
export const PYTH_DEVIATION = {
  /** Token reference vs underlying: informational warning above this. */
  tokenVsUnderlyingWarnBps: 300,
  /** Executable route vs token reference: warn above this. */
  routeVsTokenWarnBps: 100,
  /** Executable route vs token reference: refuse above this in enforce mode. */
  routeVsTokenRefuseBps: 250,
} as const;

export function pythApiKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.PYTH_PRO_API_KEY?.trim();
  return key ? key : null;
}
