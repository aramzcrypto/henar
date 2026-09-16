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
import { routerPrivateProducts } from "@/lib/private-markets/router-artifact";
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
      assetClass: "PUBLIC_EQUITY",
    };
    byId.set(view.id, view);
    byMint.set(view.mint, view);
  }
}

/* Private-market exposure products (PreStocks, Tessera) enter the same
   registry from their own committed artifact, under their own provider and
   asset class. Two products that reference the same company are two
   representations with nothing in common but a name: the engine quotes
   exactly the mint it was asked for, and the guard's pair check keeps it
   there. Whether they may be quoted at all is decided at request time by
   HENAR_PRIVATE_MARKETS_ROUTING (see `privateMarketsRoutingEnabled`). */
for (const product of routerPrivateProducts()) {
  if (byMint.has(product.mint)) continue;
  const verified = verifiedMint(product.mint);
  const view: RouterRepresentation = {
    id: `${product.provider}:${product.mint}`,
    equityId: `private:${product.companySlug}`,
    provider: product.provider,
    tokenSymbol: product.symbol,
    mint: product.mint,
    decimals: verified?.decimals ?? null,
    tokenProgram: verified?.tokenProgram ?? null,
    tokenExtensions: verified ? { scaledUiMultiplier: verified.scaledUiMultiplier, transferFeeBps: verified.transferFeeBps, readAt: verified.verifiedAt } : null,
    status: verified && !verified.supported ? "RESTRICTED" : "ACTIVE",
    assetClass: "PRIVATE_MARKET_EXPOSURE",
  };
  byId.set(view.id, view);
  byMint.set(view.mint, view);
}

export function privateMarketsRoutingEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.HENAR_PRIVATE_MARKETS_ROUTING;
  return value === "1" || value === "true";
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
