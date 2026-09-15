/**
 * A global RPC limiter and a paced external-quote helper.
 *
 * A benchmark that dies on a 429 after twenty minutes is worse than a slower
 * one that finishes: the previous run lost 315 of 350 observations to a single
 * fatal RPC rejection. Both helpers here serialise their calls, honour
 * Retry-After when a server sends it, back off adaptively, and surface a rate
 * limit as a distinguishable outcome rather than as "no route".
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { retryAfterMs } from "@/lib/execution/shared";

export { retryAfterMs };

export type Limiter = <T>(work: () => Promise<T>) => Promise<T>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimit(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|too many requests|rate.?limit/i.test(message);
}

/** The server's own wait, when the thrown error carries one. */
function serverWaitMs(error: unknown): number | null {
  const wait = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof wait === "number" && Number.isFinite(wait) && wait >= 0 ? wait : null;
}

/**
 * Serialises every call and keeps a minimum gap between them, widening that
 * gap when the server pushes back and narrowing it again once calls succeed.
 * One queue means concurrency can never defeat the interval.
 */
/**
 * Re-entrancy guard.
 *
 * Installing a limiter under a shared client and also wrapping a call site
 * with it deadlocks: the outer call holds the queue while the inner call waits
 * for the queue. That silently ended a run with no output and exit 0, so a
 * nested call now runs straight through instead of queuing behind itself.
 */
export function createLimiter(options: {
  minIntervalMs: number;
  maxIntervalMs?: number;
  retries?: number;
  label?: string;
  onBackoff?: (waitMs: number, attempt: number) => void;
}): Limiter {
  const maxInterval = options.maxIntervalMs ?? options.minIntervalMs * 16;
  const retries = options.retries ?? 5;
  let interval = options.minIntervalMs;
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  const inside = new AsyncLocalStorage<true>();

  return <T>(work: () => Promise<T>): Promise<T> => {
    if (inside.getStore()) return work();
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt += 1) {
        const wait = Math.max(0, last + interval - Date.now());
        if (wait > 0) await sleep(wait);
        last = Date.now();
        try {
          const value = await work();
          // Recover gradually; a single success is not proof the limit lifted.
          interval = Math.max(options.minIntervalMs, Math.floor(interval * 0.9));
          return value;
        } catch (error) {
          if (!isRateLimit(error) || attempt >= retries) throw error;
          interval = Math.min(maxInterval, Math.max(interval * 2, options.minIntervalMs));
          // A server that says how long to wait is obeyed; our own backoff is
          // only a floor under it.
          const wait = Math.max(interval, serverWaitMs(error) ?? 0);
          options.onBackoff?.(wait, attempt + 1);
          await sleep(wait);
        }
      }
    };
    const queued = chain.then(
      () => inside.run(true, run),
      () => inside.run(true, run),
    );
    chain = queued.catch(() => undefined);
    return queued;
  };
}
