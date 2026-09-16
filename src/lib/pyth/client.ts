/**
 * Server-only Pyth Pro HTTP client. The long-lived key never leaves the
 * server; browser code talks to Henar routes, which call this.
 *
 * Every failure is typed. A 401 is an invalid key, a 403 is "this key is not
 * entitled to that feed/channel" (the server names the feed), a 404 is an
 * unknown feed or symbol, a 429 is a rate limit, anything 5xx is an outage,
 * and a body that does not match the documented shape is malformed. None of
 * them are silently turned into a price.
 */
import { z } from "zod";
import { PYTH_PRO, pythApiKey, type PythChannel, type PythHistoryResolution } from "./config";

export type PythErrorKind = "MISSING_KEY" | "INVALID_KEY" | "NOT_ENTITLED" | "NOT_FOUND" | "RATE_LIMITED" | "BAD_REQUEST" | "UNAVAILABLE" | "MALFORMED";

export class PythProError extends Error {
  constructor(
    readonly kind: PythErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly feedIds: number[] = [],
  ) {
    super(message);
    this.name = "PythProError";
  }
}

const parsedFeed = z.object({
  priceFeedId: z.number().int(),
  price: z.union([z.string(), z.number()]).nullish(),
  exponent: z.number().int().nullish(),
  confidence: z.union([z.string(), z.number()]).nullish(),
  emaPrice: z.union([z.string(), z.number()]).nullish(),
  emaConfidence: z.union([z.string(), z.number()]).nullish(),
  publisherCount: z.number().int().nullish(),
  marketSession: z.enum(["regular", "preMarket", "postMarket", "overNight", "closed"]).nullish(),
  feedUpdateTimestamp: z.union([z.string(), z.number()]).nullish(),
});

const latestResponse = z.object({
  parsed: z
    .object({
      timestampUs: z.union([z.string(), z.number()]),
      priceFeeds: z.array(z.unknown()),
    })
    .nullish(),
});

export type PythParsedFeed = z.infer<typeof parsedFeed>;

/** Feed ids named in a 403 body such as "Not entitled: feed 1314 (invalid API key)". */
export function notEntitledFeedIds(body: string): number[] {
  return [...body.matchAll(/feed\s+(\d+)/gi)].map((m) => Number(m[1])).filter((n) => Number.isInteger(n));
}

export function classifyStatus(status: number, body: string): PythProError {
  const text = body.trim().slice(0, 200);
  if (status === 401) return new PythProError("INVALID_KEY", text || "invalid API key", status);
  if (status === 403) return new PythProError("NOT_ENTITLED", text || "not entitled", status, notEntitledFeedIds(body));
  if (status === 404) return new PythProError("NOT_FOUND", text || "unknown feed", status);
  if (status === 429) return new PythProError("RATE_LIMITED", text || "rate limited", status);
  if (status === 400) return new PythProError("BAD_REQUEST", text || "bad request", status);
  return new PythProError("UNAVAILABLE", text || `Pyth responded ${status}`, status);
}

export type PythClientOptions = { apiKey?: string | null; fetch?: typeof fetch; timeoutMs?: number };

function keyOrThrow(options: PythClientOptions) {
  const key = options.apiKey === undefined ? pythApiKey() : options.apiKey;
  if (!key) throw new PythProError("MISSING_KEY", "PYTH_PRO_API_KEY is not configured", null);
  return key;
}

async function call(url: string, init: RequestInit, options: PythClientOptions) {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? PYTH_PRO.requestTimeoutMs), cache: "no-store" });
  } catch (error) {
    throw new PythProError("UNAVAILABLE", `Pyth request failed: ${(error as Error).message}`, null);
  }
  if (!response.ok) throw classifyStatus(response.status, await response.text().catch(() => ""));
  return response;
}

/** POST /v1/latest_price for a set of feed ids on one channel. */
export async function fetchLatest(
  feedIds: number[],
  channel: PythChannel = PYTH_PRO.defaultChannel,
  options: PythClientOptions = {},
): Promise<{ timestampUs: string; feeds: PythParsedFeed[] }> {
  const key = keyOrThrow(options);
  if (!feedIds.length) return { timestampUs: "0", feeds: [] };
  const response = await call(
    `${PYTH_PRO.restBaseUrl}/v1/latest_price`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ priceFeedIds: feedIds, properties: PYTH_PRO.properties, formats: [], channel, parsed: true, jsonBinaryEncoding: "base64" }),
    },
    options,
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PythProError("MALFORMED", "latest_price body is not JSON", response.status);
  }
  const parsed = latestResponse.safeParse(body);
  if (!parsed.success || !parsed.data.parsed) throw new PythProError("MALFORMED", "latest_price body lacks a parsed payload", response.status);
  const feeds = parsed.data.parsed.priceFeeds.map((f) => parsedFeed.safeParse(f)).filter((r) => r.success).map((r) => r.data);
  return { timestampUs: String(parsed.data.parsed.timestampUs), feeds };
}

const historyResponse = z.object({
  s: z.string(),
  t: z.array(z.number()).optional(),
  o: z.array(z.union([z.number(), z.string()])).optional(),
  h: z.array(z.union([z.number(), z.string()])).optional(),
  l: z.array(z.union([z.number(), z.string()])).optional(),
  c: z.array(z.union([z.number(), z.string()])).optional(),
  v: z.array(z.union([z.number(), z.string()]).nullable()).optional(),
  errmsg: z.string().optional(),
});
export type PythHistoryPayload = z.infer<typeof historyResponse>;

/** GET /v1/{channel}/history in TradingView bar format. */
export async function fetchHistory(
  params: { symbol: string; resolution: PythHistoryResolution; from: number; to: number; channel?: PythChannel },
  options: PythClientOptions = {},
): Promise<PythHistoryPayload> {
  const key = keyOrThrow(options);
  const query = new URLSearchParams({ symbol: params.symbol, resolution: params.resolution, from: String(params.from), to: String(params.to) });
  const response = await call(
    `${PYTH_PRO.historyBaseUrl}/${params.channel ?? PYTH_PRO.defaultChannel}/history?${query}`,
    { headers: { authorization: `Bearer ${key}`, accept: "application/json" } },
    options,
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PythProError("MALFORMED", "history body is not JSON", response.status);
  }
  const parsed = historyResponse.safeParse(body);
  if (!parsed.success) throw new PythProError("MALFORMED", "history body does not match the documented shape", response.status);
  return parsed.data;
}
