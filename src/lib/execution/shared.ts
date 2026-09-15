import { PublicKey } from "@solana/web3.js";
import type {
  ExecutionQuoteRequest,
  ExecutionSource,
  ExecutionSourceResult,
  NormalizedExecutionQuote,
} from "./types";

export const QUOTE_TTL_MS = 15_000;

/**
 * A quote source pushing back, kept distinct from a source having no route.
 *
 * Conflating the two is how a rate-limited benchmark reports imaginary
 * illiquidity, so the 429 carries its own type and the server's own wait.
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry-After as seconds or an HTTP date; milliseconds, or null if absent. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

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
