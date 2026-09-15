/**
 * The router's read-only view over Henar's canonical equity registry.
 *
 * The registry is the only source of truth for which mints exist. The router
 * never adds a mint; it only narrows the registry to representations that are
 * verified and reachable, and reshapes them for quoting.
 *
 * Execution-critical mint facts do not come from the catalogue. Decimals, the
 * token program and the Token-2022 extensions come only from the verified-mint
 * artifact, read from chain at a recorded slot. The catalogue is a product
 * listing: it carries neither field, and a decimal place taken on trust is an
 * order of magnitude on every amount. A mint absent from the artifact stays
 * unverified here, and the planner keeps refusing it rather than proceeding on
 * a default.
 */
import { equityRegistry } from "@/lib/equities/registry";
import { verifiedMint } from "./verified-mints";
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
    const verified = verifiedMint(rep.mint);
    const view: RouterRepresentation = {
      id: rep.id,
      equityId: equity.id,
      provider: rep.provider,
      tokenSymbol: rep.tokenSymbol,
      mint: rep.mint,
      decimals: verified?.decimals ?? null,
      tokenProgram: verified?.tokenProgram ?? null,
      tokenExtensions: verified
        ? {
            scaledUiMultiplier: verified.scaledUiMultiplier,
            transferFeeBps: verified.transferFeeBps,
            readAt: verified.verifiedAt,
          }
        : null,
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
