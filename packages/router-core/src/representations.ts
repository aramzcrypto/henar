/**
 * The router's read-only view over Henar's canonical equity registry.
 *
 * The registry is the only source of truth for which mints exist. The router
 * never adds a mint; it only narrows the registry to representations that are
 * verified and reachable, and reshapes them for quoting.
 */
import { equityRegistry } from "@/lib/equities/registry";
import type { RouterRepresentation } from "./types";

const byId = new Map<string, RouterRepresentation>();
const byMint = new Map<string, RouterRepresentation>();

for (const equity of equityRegistry) {
  for (const rep of equity.representations) {
    if (rep.providerStatus !== "verified") continue;
    const status: RouterRepresentation["status"] =
      rep.tradingStatus === "paused"
        ? "PAUSED"
        : rep.tradingStatus === "unavailable"
          ? "RESTRICTED"
          : "ACTIVE";
    const view: RouterRepresentation = {
      id: rep.id,
      equityId: equity.id,
      provider: rep.provider,
      tokenSymbol: rep.tokenSymbol,
      mint: rep.mint,
      decimals: rep.decimals,
      tokenProgram: rep.tokenProgram,
      tokenExtensions: null,
      status,
    };
    byId.set(view.id, view);
    byMint.set(view.mint, view);
  }
}

export function routerRepresentation(id: string) {
  return byId.get(id) ?? null;
}

export function routerRepresentationForMint(mint: string) {
  return byMint.get(mint) ?? null;
}

export function listRouterRepresentations() {
  return [...byId.values()];
}
