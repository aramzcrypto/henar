/**
 * Rate-limit discipline for production RPC.
 *
 * The router's native adapters were failing in production with
 * "failed to get info for multiple accounts, RPC_ERROR, 429 Too Many
 * Requests" and with `getMultipleAccountsInfo` timeouts, while the same quote
 * completed locally in under two seconds. The cause was not slow code: a
 * single quote fans out across five pools through two venue SDKs, each
 * issuing bulk account reads, and the provider rejects the burst. Every
 * rejection surfaced as SDK_ERROR or VENUE_TIMEOUT, so a rate limit was being
 * recorded as a venue with no route — the same mistake the benchmark harness
 * made before it learned to pace itself.
 *
 * This bounds concurrency and retries a 429 with the server's own Retry-After.
 * It deliberately does not serialise: a user is waiting, and the aim is to
 * stay under the provider's burst limit rather than to eliminate parallelism.
 */
import { Connection } from "@solana/web3.js";
import { RateLimitError, retryAfterMs } from "@/lib/execution/shared";

const DEFAULT_CONCURRENCY = Number(process.env.HENAR_RPC_CONCURRENCY ?? "6");
const DEFAULT_RETRIES = Number(process.env.HENAR_RPC_RETRIES ?? "4");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded-concurrency gate. Resolves when a slot is free. */
function gate(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return async function enter() {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    return release;
  };
}

/**
 * A connection whose RPC requests stay within the provider's burst limit and
 * retry a 429 instead of failing the venue.
 */
export function rateLimitedConnection(endpoint: string, options?: { concurrency?: number; retries?: number }): Connection {
  const enter = gate(Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY));
  const retries = Math.max(0, options?.retries ?? DEFAULT_RETRIES);

  const pacedFetch: typeof fetch = async (input, init) => {
    const leave = await enter();
    try {
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(input, init);
        if (response.status !== 429) return response;
        if (attempt >= retries) {
          // Out of retries: say it is a rate limit, so the caller does not
          // record it as a venue having no liquidity.
          throw new RateLimitError("RPC rate limit (429) after retries.", retryAfterMs(response.headers.get("retry-after")));
        }
        const wait = retryAfterMs(response.headers.get("retry-after")) ?? Math.min(2_000, 150 * 2 ** attempt);
        await sleep(wait);
      }
    } finally {
      leave();
    }
  };

  return new Connection(endpoint, { commitment: "confirmed", fetch: pacedFetch });
}
