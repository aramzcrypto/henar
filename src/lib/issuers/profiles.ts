/**
 * Issuer identity, derived from the verified catalog rather than restated.
 *
 * Every field here already exists on a representation, put there by that
 * issuer's own adapter from that issuer's own source. Reading it back out of
 * the registry means the issuer pages and the company pages can never drift
 * apart, and that no issuer fact is asserted in two places.
 */
import { equityRegistry } from "@/lib/equities/registry";
import type { Representation } from "@/lib/equities/types";
import { ISSUER_IDS, type IssuerCatalog, type IssuerId, type IssuerProfile } from "./types";

const LOGOS: Record<IssuerId, string> = {
  xstocks: "/logos/issuers/xstocks.svg",
  backpack: "/logos/issuers/backpack.svg",
  ondo: "/logos/issuers/ondo.svg",
};

/** Each issuer's public source, and where its terms are documented. */
const SOURCES: Record<IssuerId, { apiUrl: string | null; docsUrl: string; instrument: string }> = {
  xstocks: {
    apiUrl: "https://api.xstocks.fi/api/v2/public",
    docsUrl: "https://docs.xstocks.fi/developers",
    instrument: "Tracker certificate issued against shares held with a custodian",
  },
  backpack: {
    apiUrl: "https://api.backpack.exchange/api/v1",
    docsUrl: "https://docs.backpack.exchange/",
    instrument: "Security entitlement withdrawn from a brokerage account as a Solana token",
  },
  ondo: {
    apiUrl: "https://api.gm.ondo.finance/v1",
    docsUrl: "https://docs.ondo.finance/ondo-global-markets/overview",
    instrument: "Total-return tracker fully backed by the underlying asset",
  },
};

/**
 * The suffix this issuer adds to a ticker, measured across its own tokens
 * rather than asserted. NVDA → NVDAx makes the suffix "x"; a token symbol
 * equal to its ticker makes it empty.
 */
export function tokenSuffix(representations: { tokenSymbol: string; equityId: string }[]) {
  const counts = new Map<string, number>();
  for (const representation of representations) {
    const ticker = representation.equityId.replace(/^equity:/, "");
    const symbol = representation.tokenSymbol;
    if (!symbol.toUpperCase().startsWith(ticker.toUpperCase())) continue;
    const suffix = symbol.slice(ticker.length);
    counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : "";
}

function representationsFor(id: IssuerId): Representation[] {
  return equityRegistry.flatMap((equity) =>
    equity.representations.filter((representation) => representation.provider === id),
  );
}

/** Registry-derived issuer identity and catalog scale. Computed once. */
const built = (() => {
  const profiles = new Map<IssuerId, IssuerProfile>();
  const catalogs = new Map<IssuerId, IssuerCatalog>();
  const mints = new Map<IssuerId, Representation[]>();
  for (const id of ISSUER_IDS) {
    const list = representationsFor(id);
    if (!list.length) continue;
    const first = list[0];
    profiles.set(id, {
      id,
      label: first.providerLabel,
      issuer: first.issuer,
      logo: LOGOS[id],
      issuerUrl: first.issuerUrl,
      ...SOURCES[id],
      redemptionModel: first.redemptionModel,
      tokenSuffix: tokenSuffix(list),
    });
    mints.set(id, list);
  }
  for (const id of ISSUER_IDS) {
    const catalog: IssuerCatalog = {
      companies: 0,
      representations: 0,
      stocks: 0,
      etfs: 0,
      soleIssuer: 0,
      sharedWithAll: 0,
    };
    for (const equity of equityRegistry) {
      const providers = new Set(equity.representations.map((item) => item.provider));
      if (!providers.has(id)) continue;
      catalog.companies += 1;
      catalog.representations += equity.representations.filter((item) => item.provider === id).length;
      if (equity.assetType === "etf") catalog.etfs += 1;
      else catalog.stocks += 1;
      if (providers.size === 1) catalog.soleIssuer += 1;
      if (providers.size >= ISSUER_IDS.length) catalog.sharedWithAll += 1;
    }
    catalogs.set(id, catalog);
  }
  return { profiles, catalogs, mints };
})();

export const issuerProfiles = [...built.profiles.values()];

export function issuerProfile(id: IssuerId) {
  return built.profiles.get(id) ?? null;
}

export function issuerCatalog(id: IssuerId): IssuerCatalog {
  return (
    built.catalogs.get(id) ?? {
      companies: 0,
      representations: 0,
      stocks: 0,
      etfs: 0,
      soleIssuer: 0,
      sharedWithAll: 0,
    }
  );
}

/** Every verified representation this issuer publishes, in catalog order. */
export function issuerRepresentations(id: IssuerId): Representation[] {
  return built.mints.get(id) ?? [];
}
