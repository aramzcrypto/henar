/**
 * Server-only Token Terminal REST client.
 *
 * The key never leaves the server; browser code talks to Henar routes. Every
 * failure is typed rather than folded into an empty result, because "this key
 * cannot read that" and "that asset does not exist" are different facts and
 * the coverage surface reports them differently.
 *
 * Token Terminal answers a missing or wrong key with `403 {"message":
 * "invalid token"}`, which is a credential failure rather than an entitlement
 * one; a 403 that says anything else is treated as an entitlement refusal.
 */
import { z } from "zod";
import { fetchWithTransientRetry } from "@/lib/http-retry";
import { TOKEN_TERMINAL, tokenTerminalApiKey } from "./config";

export type TokenTerminalErrorKind =
  | "MISSING_KEY"
  | "INVALID_KEY"
  | "NOT_ENTITLED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "UNAVAILABLE"
  | "MALFORMED";

export class TokenTerminalError extends Error {
  constructor(
    readonly kind: TokenTerminalErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "TokenTerminalError";
  }
}

export function classifyStatus(status: number, body: string): TokenTerminalError {
  const text = body.trim().slice(0, 200);
  if (status === 401) return new TokenTerminalError("INVALID_KEY", text || "invalid API key", status);
  if (status === 403)
    return /invalid token|invalid api key|unauthor/i.test(text)
      ? new TokenTerminalError("INVALID_KEY", text || "invalid API key", status)
      : new TokenTerminalError("NOT_ENTITLED", text || "not entitled", status);
  if (status === 404) return new TokenTerminalError("NOT_FOUND", text || "unknown resource", status);
  if (status === 429) return new TokenTerminalError("RATE_LIMITED", text || "rate limited", status);
  if (status === 400) return new TokenTerminalError("BAD_REQUEST", text || "bad request", status);
  return new TokenTerminalError("UNAVAILABLE", text || `Token Terminal responded ${status}`, status);
}

export type TokenTerminalOptions = { apiKey?: string | null; fetch?: typeof fetch; timeoutMs?: number };

function keyOrThrow(options: TokenTerminalOptions) {
  const key = options.apiKey === undefined ? tokenTerminalApiKey() : options.apiKey;
  if (!key)
    throw new TokenTerminalError(
      "MISSING_KEY",
      "TOKENTERMINAL_API_KEY is not configured; the REST API is on Token Terminal's API plan",
      null,
    );
  return key;
}

async function call(path: string, init: RequestInit, options: TokenTerminalOptions) {
  const key = keyOrThrow(options);
  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchWithTransientRetry(() =>
      fetchImpl(`${TOKEN_TERMINAL.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(options.timeoutMs ?? TOKEN_TERMINAL.requestTimeoutMs),
        cache: "no-store",
      }),
    );
  } catch (error) {
    throw new TokenTerminalError("UNAVAILABLE", `Token Terminal request failed: ${(error as Error).message}`, null);
  }
  if (!response.ok) throw classifyStatus(response.status, await response.text().catch(() => ""));
  try {
    return await response.json();
  } catch {
    throw new TokenTerminalError("MALFORMED", `${path} did not return JSON`, response.status);
  }
}

const addressSchema = z.object({
  chain_id: z.string().nullish(),
  token_address: z.string().nullish(),
  token_name: z.string().nullish(),
  token_symbol: z.string().nullish(),
});

const productSchema = z.object({
  data_id: z.string().nullish(),
  product_id: z.string().nullish(),
  relation_to_the_project: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
});

const assetSchema = z.object({
  asset_id: z.string(),
  asset_type: z.string().nullish(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  reference_asset_id: z.string().nullish(),
  addresses: z.array(addressSchema).nullish(),
  products: z.array(productSchema).nullish(),
});

export type TokenTerminalAsset = z.infer<typeof assetSchema>;

const metricValueSchema = z.object({
  latest: z.number().nullish(),
  avg: z.number().nullish(),
  sum: z.number().nullish(),
  change: z.number().nullish(),
});

const breakdownRowSchema = z.object({
  asset_id: z.string().nullish(),
  data_id: z.string().nullish(),
  chain_id: z.string().nullish(),
  reference_asset_id: z.string().nullish(),
  metrics: z.record(z.string(), metricValueSchema).nullish(),
});

export type TokenTerminalBreakdownRow = z.infer<typeof breakdownRowSchema>;

function rawRows(payload: unknown): unknown[] {
  return payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : [];
}

function listOf<T>(payload: unknown, schema: z.ZodType<T>): T[] {
  return rawRows(payload).flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** GET /v2/assets, paged to the end of the catalog. */
export async function fetchAssets(
  params: { assetTypes?: string[]; marketSectors?: string[]; referenceAssetIds?: string[] } = {},
  options: TokenTerminalOptions = {},
): Promise<TokenTerminalAsset[]> {
  const collected: TokenTerminalAsset[] = [];
  for (let page = 0; page < TOKEN_TERMINAL.maxPages; page++) {
    const query = new URLSearchParams({
      limit: String(TOKEN_TERMINAL.pageSize),
      offset: String(page * TOKEN_TERMINAL.pageSize),
    });
    if (params.assetTypes?.length) query.set("asset_types", params.assetTypes.join(","));
    if (params.marketSectors?.length) query.set("market_sectors", params.marketSectors.join(","));
    if (params.referenceAssetIds?.length) query.set("reference_asset_ids", params.referenceAssetIds.join(","));
    const payload = await call(`${TOKEN_TERMINAL.endpoints.assets}?${query}`, { method: "GET" }, options);
    collected.push(...listOf(payload, assetSchema));
    /* Paging ends on what the page actually contained, not on what survived
       validation. Counting the parsed rows would let a single malformed asset
       shorten a full page and silently truncate the catalog there. */
    if (rawRows(payload).length < TOKEN_TERMINAL.pageSize) break;
  }
  return collected;
}

/** POST /v2/assets/{asset_id}/metrics-breakdown, grouped across a set of assets. */
export async function fetchAssetBreakdown(
  anchorAssetId: string,
  body: { metricIds: string[]; assetIds: string[]; interval?: string },
  options: TokenTerminalOptions = {},
): Promise<TokenTerminalBreakdownRow[]> {
  const payload = await call(
    TOKEN_TERMINAL.endpoints.assetBreakdown(anchorAssetId),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metric_ids: body.metricIds,
        group_by: "assets",
        asset_ids: body.assetIds,
        interval: body.interval ?? "24h",
        includeSelf: true,
      }),
    },
    options,
  );
  return listOf(payload, breakdownRowSchema);
}

const metricPointSchema = z.object({
  timestamp: z.string(),
  asset_id: z.string().nullish(),
  metric_id: z.string().nullish(),
  value: z.union([z.string(), z.number()]).nullish(),
});

export type TokenTerminalMetricPoint = z.infer<typeof metricPointSchema>;

/** GET /v2/assets/{asset_id}/metrics for one metric's history. */
export async function fetchAssetMetrics(
  assetId: string,
  params: { metricId: string; interval?: string },
  options: TokenTerminalOptions = {},
): Promise<TokenTerminalMetricPoint[]> {
  const query = new URLSearchParams({ metric_id: params.metricId, order_direction: "desc" });
  if (params.interval) query.set("interval", params.interval);
  const payload = await call(
    `${TOKEN_TERMINAL.endpoints.assetMetrics(assetId)}?${query}`,
    { method: "GET" },
    options,
  );
  return listOf(payload, metricPointSchema);
}
