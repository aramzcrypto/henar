/** Coalesces read-only work. Failed reads never replace a successful snapshot. */
export function createReadCache<T>(ttlMs: number, maximum = 128) {
  const values = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();
  return async (key: string, read: () => Promise<T>, fresh = false) => {
    const current = values.get(key);
    if (!fresh && current && current.expires > Date.now()) return current.value;
    const running = pending.get(key);
    if (running) return running;
    const task = read()
      .then((value) => {
        values.delete(key);
        values.set(key, { value, expires: Date.now() + ttlMs });
        while (values.size > maximum)
          values.delete(values.keys().next().value!);
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}
