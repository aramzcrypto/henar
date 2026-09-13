import type { Equity } from "./types";
import { backpackRoutes, backpackSnapshot } from "./providers/backpack-primary";
export async function providerRoutes(equity: Equity) {
  if (!equity.representations.some((r) => r.provider === "backpack"))
    return { routes: [], backpackStatus: "not_applicable" as const };
  try {
    const snapshot = await backpackSnapshot();
    return {
      routes: equity.representations.flatMap((r) =>
        backpackRoutes(r, snapshot),
      ),
      backpackStatus: "available" as const,
    };
  } catch {
    return { routes: [], backpackStatus: "unavailable" as const };
  }
}
