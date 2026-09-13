import type { Equity, EarnDiscovery } from "../types";
import { kaminoOpportunities } from "./kamino";
import { vedaDiscovery } from "./veda";
export async function discoverEarn(equity: Equity): Promise<EarnDiscovery> {
  const veda = vedaDiscovery();
  try {
    return {
      opportunities: await kaminoOpportunities(equity),
      sources: [
        { protocol: "Kamino", status: "available", reason: null },
        ...veda.sources,
      ],
    };
  } catch {
    return {
      opportunities: [],
      sources: [
        {
          protocol: "Kamino",
          status: "unavailable",
          reason: "Live reserve discovery is temporarily unavailable.",
        },
        ...veda.sources,
      ],
    };
  }
}
