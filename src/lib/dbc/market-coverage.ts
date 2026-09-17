import { loadPoolRegistry } from "@henar/router-core";
import type { Equity } from "@/lib/equities/types";

/**
 * Representations of this company that already have an enabled pool.
 *
 * Server only: it reads the committed pool registry, which is large and has
 * no business in a browser bundle. The company page calls it and passes the
 * answer down as a boolean.
 */
export function tradableRepresentations(equity: Equity) {
  const enabled = new Set(
    loadPoolRegistry()
      .pools.filter((p) => p.enabled)
      .map((p) => p.mint),
  );
  return equity.representations.filter((r) => enabled.has(r.mint));
}
