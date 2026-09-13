import { PublicKey } from "@solana/web3.js";
import type {
  ExecutionQuoteRequest,
  ExecutionSource,
  ExecutionSourceResult,
  NormalizedExecutionQuote,
} from "./types";

export const QUOTE_TTL_MS = 15_000;

export function validateExecutionRequest(request: ExecutionQuoteRequest) {
  new PublicKey(request.inputMint);
  new PublicKey(request.outputMint);
  if (request.inputMint === request.outputMint)
    throw new Error("Choose two different assets.");
  if (request.amount <= 0n || request.amount > (1n << 64n) - 1n)
    throw new Error("Invalid raw quote amount.");
  if (
    !Number.isInteger(request.slippageBps) ||
    request.slippageBps < 1 ||
    request.slippageBps > 100
  )
    throw new Error("Slippage must be between 1 and 100 basis points.");
}

export function minimumOutput(output: bigint, slippageBps: number) {
  return (output * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function unavailable(
  source: ExecutionSource,
  reason: string,
): ExecutionSourceResult {
  return { source, status: "unavailable", reason };
}

export function available(
  quote: NormalizedExecutionQuote,
): ExecutionSourceResult {
  return { source: quote.source, status: "available", quote };
}

export function sourceReason(error: unknown) {
  if (!(error instanceof Error)) return "Quote source unavailable.";
  if (/not configured/i.test(error.message)) return error.message;
  if (/timed out|abort/i.test(error.message)) return "Quote source timed out.";
  if (/no route|not found|404/i.test(error.message))
    return "No route for this pair and amount.";
  return "Quote source unavailable.";
}

export async function withDeadline<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Quote source timed out.")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
