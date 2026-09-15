/**
 * One quote request, one read of each account.
 *
 * A single representation can have five enabled pools. Each adapter reads its
 * own pool state, and every one of them also re-reads the same two mint
 * accounts and asks for its own slot; then the split optimizer calls `curve()`
 * on each pool, which reads all of that a second time. Nothing here is wrong
 * arithmetically, but in production four of five native pool quotes were
 * timing out at the 6s venue deadline, which left the optimizer with fewer
 * than the two curves it needs and made a split impossible.
 *
 * This memoizes identical reads for the lifetime of one request. Freshness is
 * unchanged: every read already happened inside a single quote request, and
 * the cache does not outlive it.
 *
 * The wrapper identity is stable per underlying connection, deliberately. The
 * venue SDKs keep their heavy clients in WeakMaps keyed on the connection
 * object, so handing them a new wrapper per request would reload the Raydium
 * client on every quote and cost far more than it saved. Invalidation is by
 * epoch instead: `begin()` makes every earlier entry unreadable.
 */
import type { Connection } from "@solana/web3.js";

type Entry = { epoch: number; value: Promise<unknown> };

export type RequestScopedConnection = {
  /** Pass this to adapters in place of the raw connection. */
  connection: Connection;
  /** Start a new request: everything cached before this is discarded. */
  begin: () => void;
  stats: () => { hits: number; misses: number; epoch: number };
};

/** Methods whose result is identical for identical arguments within a request. */
const CACHEABLE = new Set(["getSlot", "getAccountInfo", "getMultipleAccountsInfo", "getParsedAccountInfo", "getTokenAccountBalance", "getLatestBlockhash", "getMinimumBalanceForRentExemption"]);

const wrappers = new WeakMap<Connection, RequestScopedConnection>();

function keyFor(method: string, args: unknown[]): string {
  const parts = args.map((arg) => {
    if (arg === undefined || arg === null) return "";
    if (Array.isArray(arg)) return arg.map((a) => String(a)).join(",");
    if (typeof arg === "object") {
      const o = arg as Record<string, unknown>;
      // Commitment-ish option bags only; anything else is not treated as equal.
      return Object.keys(o)
        .sort()
        .map((k) => `${k}=${String(o[k])}`)
        .join("&");
    }
    return String(arg);
  });
  return `${method}(${parts.join("|")})`;
}

/**
 * A memoizing view over one connection. Repeated calls return the same
 * promise; a rejection is evicted so a later attempt can still succeed.
 */
export function requestScopedConnection(connection: Connection): RequestScopedConnection {
  const existing = wrappers.get(connection);
  if (existing) return existing;

  const cache = new Map<string, Entry>();
  let epoch = 0;
  let hits = 0;
  let misses = 0;

  const proxy = new Proxy(connection, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string" || !CACHEABLE.has(property)) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        const key = keyFor(property, args);
        const hit = cache.get(key);
        if (hit && hit.epoch === epoch) {
          hits += 1;
          return hit.value;
        }
        misses += 1;
        const promise = (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        cache.set(key, { epoch, value: promise });
        // A failed read must not be remembered as the answer.
        promise.catch(() => {
          const current = cache.get(key);
          if (current && current.value === promise) cache.delete(key);
        });
        return promise;
      };
    },
  }) as Connection;

  const wrapper: RequestScopedConnection = {
    connection: proxy,
    begin: () => {
      epoch += 1;
      cache.clear();
    },
    stats: () => ({ hits, misses, epoch }),
  };
  wrappers.set(connection, wrapper);
  return wrapper;
}
