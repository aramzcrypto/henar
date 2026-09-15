import { z } from "zod";
import type {
  ExecutionQuoteRequest,
  ExecutionSource,
  NormalizedExecutionQuote,
} from "../types";
import {
  minimumOutput,
  QUOTE_TTL_MS,
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
): Promise<NormalizedExecutionQuote> {
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
  if (!response.ok) throw new Error("No route from Jupiter.");
  const value = schema.parse(await response.json());
  const output = BigInt(value.outAmount);
  if (
    value.inputMint !== request.inputMint ||
    value.outputMint !== request.outputMint ||
    value.inAmount !== request.amount.toString() ||
    output <= 0n ||
    (value.slippageBps !== undefined &&
      value.slippageBps !== request.slippageBps &&
      // Jupiter's v2 order endpoint may widen slippage dynamically on larger
      // sizes. Callers that set their own floor (the Henar Router) opt out of
      // this equality check; the production path keeps it.
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
