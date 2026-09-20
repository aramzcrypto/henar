/**
 * Token Terminal configuration.
 *
 * Token Terminal indexes tokenized assets — stablecoins, tokenized funds and
 * tokenized stocks — as first-class assets with issuers, chains and a
 * reference asset each token tracks. That is the same shape Henar's registry
 * already has, which makes it a genuine cross-check on an issuer's own
 * numbers rather than a second copy of them.
 *
 * Access: the REST API is a paid plan. The free plan covers the Explorer,
 * Sheets and the MCP server, none of which issue a REST key. Probed on
 * 20 September 2026 with no key, every v2 route answers
 * `403 {"message":"invalid token"}`. So Henar reads Token Terminal only where
 * `TOKENTERMINAL_API_KEY` is configured and says so plainly where it is not.
 *
 * Sources (read 20 September 2026):
 *   https://tokenterminal.com/docs/api-reference/introduction
 *   https://tokenterminal.com/docs/api-reference/openapi.json
 *   https://tokenterminal.com/pricing
 */
export const TOKEN_TERMINAL = {
  baseUrl: "https://api.tokenterminal.com",
  /** Asset-level routes. Paths are exactly as the published spec defines them. */
  endpoints: {
    assets: "/v2/assets",
    asset: (assetId: string) => `/v2/assets/${encodeURIComponent(assetId)}`,
    assetMetrics: (assetId: string) => `/v2/assets/${encodeURIComponent(assetId)}/metrics`,
    assetBreakdown: (assetId: string) => `/v2/assets/${encodeURIComponent(assetId)}/metrics-breakdown`,
    referenceAssets: "/v2/reference-assets",
    metrics: "/v2/metrics",
  },
  /** Maximum assets per page, per the spec's documented bound. */
  pageSize: 1_000,
  /** Bounded so a paging change cannot walk forever. */
  maxPages: 12,
  requestTimeoutMs: 12_000,
  /** Documented limit on the API plan: 1,000 requests per minute. */
  rateLimitPerMinute: 1_000,
  docsUrl: "https://tokenterminal.com/docs/api-reference/introduction",
  pricingUrl: "https://tokenterminal.com/pricing",
  explorerUrl: "https://tokenterminal.com/explorer/tokenized-assets/rwas",
} as const;

/**
 * Asset metrics Henar asks for. Every id here appears in the published API
 * schema; an id a key cannot read comes back as unavailable for that asset
 * rather than as zero.
 */
export const TOKEN_TERMINAL_METRICS = {
  marketCap: "asset_market_cap_circulating",
  holders: "asset_holders",
  transferVolume: "asset_transfer_volume",
  price: "asset_price",
} as const;

export type TokenTerminalMetric = (typeof TOKEN_TERMINAL_METRICS)[keyof typeof TOKEN_TERMINAL_METRICS];

export const TOKEN_TERMINAL_CACHE = {
  assetsMs: 60 * 60_000,
  metricsMs: 15 * 60_000,
  coverageMs: 30 * 60_000,
} as const;

export function tokenTerminalApiKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.TOKENTERMINAL_API_KEY?.trim();
  return key ? key : null;
}
