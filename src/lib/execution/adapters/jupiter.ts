import { z } from "zod";
import type {
  ExecutionQuoteRequest,
  ExecutionSource,
  SourceExecutionQuote,
} from "../types";
import {
  minimumOutput,
  QUOTE_TTL_MS,
  RateLimitError,
  retryAfterMs,
  validateExecutionRequest,
} from "../shared";

const schema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string().regex(/^\d+$/),
  outAmount: z.string().regex(/^\d+$/),
  otherAmountThreshold: z.string().regex(/^\d+$/).optional(),
  slippageBps: z.number().int().optional(),
  priceImpactPct: z.union([z.string(), z.number()]).optional(),
  router: z.string().optional(),
  contextSlot: z.number().int().optional(),
  /* Jupiter's own fee, if it charges one. Henar used to record
     `providerFeeBps: 0` for Jupiter as a fact, without ever reading these
     fields. Whether a provider takes a cut is not something to assume. */
  feeBps: z.number().optional(),
  platformFee: z.object({ amount: z.string().optional(), feeBps: z.number().optional() }).nullish(),
  routePlan: z
    .array(
      z.object({
        percent: z.number().nullable().optional(),
        swapInfo: z.object({
          ammKey: z.string().optional(),
          label: z.string().optional(),
        }),
      }),
    )
    .default([]),
});

function key() {
  const value = process.env.JUPITER_API_KEY;
  if (!value) throw new Error("Jupiter is not configured.");
  return value;
}

/**
 * Jupiter answers the same question at two endpoints, and they disagree.
 *
 * `/swap/v2/order` reaches JupiterZ, Jupiter's own RFQ network, which is
 * worth a great deal on thin names — measured 17 September 2026, it beat the
 * plain quote by 262 bps on AMC and 102 bps on IBM. `/swap/v1/quote` does
 * not reach it, but on liquid names where both find the same route the v1
 * answer came back consistently about 10 bps better, in 7 of 14 pairs and
 * almost exactly 10 bps each time.
 *
 * Henar was asking only the v2 endpoint, so on every liquid pair it handed
 * the user a price 10 bps below what Jupiter itself would quote, and then
 * charged 10 bps on top. The user paid the difference twice over and Henar
 * could not have known, because it recorded Jupiter's provider fee as zero
 * without ever reading the field.
 *
 * So ask both and keep the better answer. It is one extra call on a path
 * that already fans out to four providers, and it is the difference between
 * reselling Jupiter at a discount and reselling it at Jupiter's own price.
 */
/** `HENAR_JUPITER_RACE=0` falls back to one call, if rate limits ever bite. */
function raceEnabled() {
  const value = process.env.HENAR_JUPITER_RACE;
  return value !== "0" && value !== "false";
}

async function bestOfJupiterEndpoints(
  request: ExecutionQuoteRequest,
  options: { source: ExecutionSource; allowSlippageAdjustment?: boolean },
): Promise<SourceExecutionQuote> {
  if (!raceEnabled()) return quoteFromEndpoint(request, { ...options, endpoint: "order" });
  const [order, quote] = await Promise.allSettled([
    quoteFromEndpoint(request, { ...options, endpoint: "order" }),
    quoteFromEndpoint(request, { ...options, endpoint: "quote" }),
  ]);
  const ok = [order, quote].flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) {
    /* Both refused. Surface the order endpoint's reason when there is one, so
       a rate limit still reads as a rate limit rather than as "no route". */
    if (order.status === "rejected") throw order.reason;
    throw (quote as PromiseRejectedResult).reason;
  }
  return ok.reduce((best, candidate) => (BigInt(candidate.outputAmount) > BigInt(best.outputAmount) ? candidate : best));
}

export async function quoteJupiter(
  request: ExecutionQuoteRequest,
  options?: { source?: ExecutionSource; dexes?: string[]; allowSlippageAdjustment?: boolean },
): Promise<SourceExecutionQuote> {
  validateExecutionRequest(request);
  const source = options?.source ?? "jupiter";
  // A venue-restricted probe asks one endpoint; only the unrestricted meta
  // route has two answers worth racing.
  if (!options?.dexes?.length)
    return bestOfJupiterEndpoints(request, { source, allowSlippageAdjustment: options?.allowSlippageAdjustment });
  return quoteFromEndpoint(request, { ...options, source, endpoint: "restricted" });
}

async function quoteFromEndpoint(
  request: ExecutionQuoteRequest,
  options: {
    source: ExecutionSource;
    dexes?: string[];
    allowSlippageAdjustment?: boolean;
    endpoint: "order" | "quote" | "restricted";
  },
): Promise<SourceExecutionQuote> {
  const source = options.source;
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount.toString(),
    slippageBps: String(request.slippageBps),
  });
  // Jupiter V1 supports venue restrictions. This lets Henar independently
  // compare a specific pool family while V2 remains the unrestricted meta route.
  const restricted = options.endpoint === "restricted";
  if (restricted) {
    params.set("swapMode", "ExactIn");
    params.set("dexes", (options.dexes ?? []).join(","));
    params.set("instructionVersion", "V2");
  }
  const endpoint =
    options.endpoint === "order"
      ? "https://api.jup.ag/swap/v2/order"
      : "https://api.jup.ag/swap/v1/quote";
  const response = await fetch(`${endpoint}?${params}`, {
    headers: { "x-api-key": key() },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  // A 429 is Jupiter refusing to answer, not Jupiter answering "no route".
  // Callers that pace themselves need to tell those apart to retry correctly.
  if (response.status === 429)
    throw new RateLimitError(
      "Jupiter rate limit (429).",
      retryAfterMs(response.headers.get("retry-after")),
    );
  if (!response.ok) throw new Error(`No route from Jupiter (status ${response.status}).`);
  const value = schema.parse(await response.json());
  const output = BigInt(value.outAmount);
  if (
    value.inputMint !== request.inputMint ||
    value.outputMint !== request.outputMint ||
    value.inAmount !== request.amount.toString() ||
    output <= 0n ||
    /* Only a WIDER slippage than asked is a terms mismatch.
       Jupiter's v2 order endpoint answers a firm RFQ with slippageBps 0 and
       otherAmountThreshold equal to outAmount, which is strictly better
       protection than the 50 bps requested. Demanding equality rejected those
       quotes outright, so Jupiter vanished from the comparison on exactly the
       pairs and sizes where it had a firm price: AAPLx at $10,000 showed
       Raydium and OpenOcean only, and the best quote badge went to a route
       that Jupiter beat. A tighter floor is never a reason to refuse. */
    (value.slippageBps !== undefined &&
      value.slippageBps > request.slippageBps &&
      !options.allowSlippageAdjustment)
  )
    throw new Error("Jupiter quote terms did not match the request.");
  const minimum = value.otherAmountThreshold
    ? BigInt(value.otherAmountThreshold)
    : minimumOutput(output, request.slippageBps);
  if (minimum <= 0n || minimum > output)
    throw new Error("Jupiter returned invalid minimum output.");
  const now = Date.now();
  return {
    source,
    quoteProvider: "jupiter",
    quoteId: null,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inputAmount: request.amount.toString(),
    grossOutputAmount: output.toString(),
    outputAmount: output.toString(),
    minimumOutputAmount: minimum.toString(),
    providerFeeBps: value.platformFee?.feeBps ?? value.feeBps ?? 0,
    providerFeeAmount: value.platformFee?.amount ?? "0",
    priceImpactPct:
      value.priceImpactPct === undefined ? null : String(value.priceImpactPct),
    route: value.routePlan.map((step) => ({
      venue: step.swapInfo.label ?? value.router ?? "Jupiter venue",
      pool: step.swapInfo.ammKey ?? null,
      percent: step.percent ?? null,
    })),
    contextSlot: value.contextSlot ?? null,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    transactionAvailable: false,
  };
}

export const quoteOrca = (request: ExecutionQuoteRequest) =>
  quoteJupiter(request, {
    source: "orca",
    dexes: ["Whirlpool", "Orca V1", "Orca V2"],
  });

export const quoteMeteora = (request: ExecutionQuoteRequest) =>
  quoteJupiter(request, {
    source: "meteora",
    dexes: ["Meteora", "Meteora DLMM", "Meteora DAMM v2"],
  });

export const quotePhoenix = (request: ExecutionQuoteRequest) =>
  quoteJupiter(request, { source: "phoenix", dexes: ["Phoenix"] });

export const quoteOpenBook = (request: ExecutionQuoteRequest) =>
  quoteJupiter(request, {
    source: "openbook",
    dexes: ["OpenBook", "Openbook", "OpenBook V2"],
  });

export const quoteLifinity = (request: ExecutionQuoteRequest) =>
  quoteJupiter(request, {
    source: "lifinity",
    dexes: ["Lifinity V1", "Lifinity V2"],
  });
