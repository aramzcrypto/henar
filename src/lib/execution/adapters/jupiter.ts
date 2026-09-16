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

export async function quoteJupiter(
  request: ExecutionQuoteRequest,
  options?: { source?: ExecutionSource; dexes?: string[]; allowSlippageAdjustment?: boolean },
): Promise<SourceExecutionQuote> {
  validateExecutionRequest(request);
  const source = options?.source ?? "jupiter";
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount.toString(),
    slippageBps: String(request.slippageBps),
  });
  // Jupiter V1 supports venue restrictions. This lets Henar independently
  // compare a specific pool family while V2 remains the unrestricted meta route.
  const restricted = Boolean(options?.dexes?.length);
  if (restricted) {
    params.set("swapMode", "ExactIn");
    params.set("dexes", options!.dexes!.join(","));
    params.set("instructionVersion", "V2");
  }
  const endpoint = restricted
    ? "https://api.jup.ag/swap/v1/quote"
    : "https://api.jup.ag/swap/v2/order";
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
      !options?.allowSlippageAdjustment)
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
    providerFeeBps: 0,
    providerFeeAmount: "0",
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
