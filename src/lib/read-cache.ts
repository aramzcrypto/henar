/**
 * Coalesces read-only work. Failed reads never replace a successful snapshot.
 *
 * `staleWhileRevalidate` decides what happens to the unlucky request that
 * arrives just after the TTL lapses. By default it waits for the fresh read,
 * which is the only correct answer for a price: showing a stale quote is worse
 * than making someone wait.
 *
 * For data that is not a price it is the wrong trade. The Pyth entitlement
 * probe asks about 119 feeds and takes over twenty seconds, so every ten
 * minutes one visitor to /markets/data paid a twenty-second wait for coverage
 * metadata that had barely changed. With this on, that visitor gets the
 * previous snapshot at once and the refresh happens behind them.
 *
 * Opt in per cache, never globally, and never for a price.
 */
export function createReadCache<T>(
  ttlMs: number,
  maximum = 128,
  options: { staleWhileRevalidate?: boolean } = {},
) {
  const values = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();
  return async (key: string, read: () => Promise<T>, fresh = false) => {
    const current = values.get(key);
    if (!fresh && current && current.expires > Date.now()) return current.value;
    const running = pending.get(key);
    if (running) return current && options.staleWhileRevalidate && !fresh ? current.value : running;
    if (!fresh && current && options.staleWhileRevalidate) {
      /* Kick the refresh off and hand back what we have. The rejection is
         swallowed here because the read below already records failures the
         same way, and an unhandled rejection would take the process down for
         a background refresh nobody is waiting on. */
      void refresh().catch(() => undefined);
      return current.value;
    }
    return refresh();

    function refresh() {
      const task = read()
        .then((value) => {
          values.delete(key);
          values.set(key, { value, expires: Date.now() + ttlMs });
          while (values.size > maximum) values.delete(values.keys().next().value!);
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    }
  };
}
