import type { EarnDiscovery } from "../types";
/** No verified Solana stock-vault mint mapping and public rate feed is configured.
 * A protocol name or ecosystem announcement is not evidence of an opportunity.
 */
export function vedaDiscovery(): EarnDiscovery {
  return {
    opportunities: [],
    sources: [
      {
        protocol: "Veda",
        status: "unavailable",
        reason: "No verified Solana stock-vault feed connected.",
      },
    ],
  };
}
