import { z } from "zod";
import type { ExecutionQuoteRequest, NormalizedExecutionQuote } from "../types";
import { QUOTE_TTL_MS, validateExecutionRequest } from "../shared";

const schema = z.object({
  id: z.string(),
  success: z.literal(true),
  data: z.object({
    inputMint: z.string(),
    inputAmount: z.string().regex(/^\d+$/),
    outputMint: z.string(),
    outputAmount: z.string().regex(/^\d+$/),
    otherAmountThreshold: z.string().regex(/^\d+$/),
    slippageBps: z.number().int(),
    priceImpactPct: z.union([z.string(), z.number()]).optional(),
    routePlan: z.array(
      z.object({
        poolId: z.string(),
        feeRate: z.number().optional(),
      }),
    ),
  }),
});

export async function quoteRaydium(
  request: ExecutionQuoteRequest,
): Promise<NormalizedExecutionQuote> {
  validateExecutionRequest(request);
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount.toString(),
    slippageBps: String(request.slippageBps),
    txVersion: "V0",
  });
  const response = await fetch(
    `https://transaction-v1.raydium.io/compute/swap-base-in?${params}`,
    { cache: "no-store", signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error("No route from Raydium.");
  const value = schema.parse(await response.json());
  const data = value.data;
  const output = BigInt(data.outputAmount);
  const minimum = BigInt(data.otherAmountThreshold);
  if (
    data.inputMint !== request.inputMint ||
    data.outputMint !== request.outputMint ||
    data.inputAmount !== request.amount.toString() ||
    data.slippageBps !== request.slippageBps ||
    output <= 0n ||
    minimum <= 0n ||
    minimum > output
  )
    throw new Error("Raydium quote terms did not match the request.");
  const now = Date.now();
  return {
    source: "raydium",
    quoteProvider: "raydium",
    quoteId: value.id,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inputAmount: request.amount.toString(),
    grossOutputAmount: output.toString(),
    outputAmount: output.toString(),
    minimumOutputAmount: minimum.toString(),
    providerFeeBps: 0,
    providerFeeAmount: "0",
    priceImpactPct:
      data.priceImpactPct === undefined ? null : String(data.priceImpactPct),
    route: data.routePlan.map((step) => ({
      venue: "Raydium",
      pool: step.poolId,
      percent: data.routePlan.length === 1 ? 100 : null,
    })),
    contextSlot: null,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    // Raydium can build a transaction, but Henar does not mark it executable
    // until its instructions pass the wallet-custody policy and simulation gate.
    transactionAvailable: false,
  };
}
