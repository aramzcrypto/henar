import { PublicKey } from "@solana/web3.js";
import type { ExecutionQuoteRequest, SourceExecutionQuote } from "../types";
import {
  minimumOutput,
  QUOTE_TTL_MS,
  validateExecutionRequest,
  withDeadline,
} from "../shared";

function titanUrl() {
  const endpoint = process.env.TITAN_WS_URL;
  const token = process.env.TITAN_API_KEY;
  if (!endpoint || !token) throw new Error("Titan is not configured.");
  const url = new URL(endpoint);
  url.searchParams.set("auth", token);
  return url.toString();
}

export async function quoteTitan(
  request: ExecutionQuoteRequest,
): Promise<SourceExecutionQuote> {
  validateExecutionRequest(request);
  const { V1Client } = await import("@titanexchange/sdk-ts");
  const client = await withDeadline(V1Client.connect(titanUrl()), 5_000);
  try {
    const value = await withDeadline(
      client.getSwapPrice({
        inputMint: new PublicKey(request.inputMint).toBytes(),
        outputMint: new PublicKey(request.outputMint).toBytes(),
        amount: request.amount,
      }),
      5_000,
    );
    const input = BigInt(value.amountIn);
    const output = BigInt(value.amountOut);
    if (input !== request.amount || output <= 0n)
      throw new Error("Titan quote terms did not match the request.");
    const now = Date.now();
    return {
      source: "titan",
      quoteProvider: "titan",
      quoteId: value.id,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inputAmount: input.toString(),
      grossOutputAmount: output.toString(),
      outputAmount: output.toString(),
      minimumOutputAmount: minimumOutput(
        output,
        request.slippageBps,
      ).toString(),
      providerFeeBps: 0,
      providerFeeAmount: "0",
      priceImpactPct: null,
      route: [{ venue: "Titan Argos", pool: null, percent: 100 }],
      contextSlot: null,
      quotedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
      transactionAvailable: false,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
