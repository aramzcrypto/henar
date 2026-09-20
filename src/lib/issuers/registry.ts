/**
 * The issuer view of Henar's catalog, assembled from four independent reads.
 *
 * Each block keeps its own source and its own availability, and one failing
 * never fabricates another. An issuer whose API is down still shows its
 * catalog scale and its on-chain market, because those come from Henar's own
 * registry and from Solana; an issuer with no public API shows everything
 * except its own disclosures, and says which one is missing and why.
 *
 *   catalog      Henar's verified registry      always available, no network
 *   market       Jupiter, over every mint       the shared catalog-wide pass
 *   disclosure   the issuer's own public API    xStocks and Backpack today
 *   external     Token Terminal                 only with an API-plan key
 */
import { issuerExternalCoverage } from "@/lib/tokenterminal/coverage";
import { tokenTerminalApiKey, TOKEN_TERMINAL } from "@/lib/tokenterminal/config";
import { backpackDisclosure, BACKPACK_API } from "./providers/backpack";
import { ondoDisclosure, ONDO_API } from "./providers/ondo";
import { xstocksDisclosure, XSTOCKS_API } from "./providers/xstocks";
import { issuerCatalog, issuerProfiles } from "./profiles";
import { issuerMarkets } from "./market";
import { JUPITER_TOKEN_API } from "@/lib/equities/catalog-market";
import { issuerProfile } from "./profiles";
import { aggregateIssuerMarket } from "./market";
import { catalogMarket } from "@/lib/equities/catalog-market";
import type {
  IssuerDisclosure,
  IssuerId,
  IssuerIntelligence,
  IssuerProfileData,
  IssuerSnapshot,
  IssuerSourceStatus,
} from "./types";

function sum(values: (number | null)[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

async function disclosures(options: {
  fetch?: typeof fetch;
  fresh?: boolean;
}): Promise<Record<IssuerId, IssuerDisclosure>> {
  const [xstocks, backpack, ondo] = await Promise.all([
    xstocksDisclosure(options),
    backpackDisclosure(),
    ondoDisclosure(options),
  ]);
  return { xstocks, backpack, ondo };
}

export async function issuerIntelligence(
  options: { fetch?: typeof fetch; fresh?: boolean; external?: boolean } = {},
): Promise<IssuerIntelligence> {
  const wantsExternal = options.external ?? Boolean(tokenTerminalApiKey());
  const [markets, published] = await Promise.all([
    issuerMarkets(options).catch(() => null),
    disclosures(options),
  ]);
  const issuers: IssuerSnapshot[] = await Promise.all(
    issuerProfiles.map(async (profile) => ({
      profile,
      catalog: issuerCatalog(profile.id),
      market:
        markets?.[profile.id] ??
        ({
          status: "unavailable",
          mintsQueried: issuerCatalog(profile.id).representations,
          mintsWithMarket: 0,
          tradedMints: 0,
          pricedMints: 0,
          mintsWithLiquidity: 0,
          volume24hUsd: null,
          liquidityUsd: null,
          marketCapUsd: null,
          holders: null,
          traders24h: null,
          top: [],
          reason: "The on-chain market source could not be read.",
          provenance: {
            source: "Jupiter",
            provider: "jupiter",
            sourceType: "dex-index",
            observedAt: new Date().toISOString(),
            url: JUPITER_TOKEN_API,
          },
        } as IssuerSnapshot["market"]),
      disclosure: published[profile.id],
      external: wantsExternal ? await issuerExternalCoverage(profile.id, options).catch(() => null) : null,
    })),
  );

  const sources: IssuerSourceStatus[] = [
    {
      id: "henar",
      label: "Henar registry",
      status: "available",
      url: null,
      reason: null,
      role: "Verified mints grouped by company, with each issuer's own source recorded",
    },
    {
      id: "jupiter",
      label: "Jupiter",
      status: markets ? "available" : "unavailable",
      url: JUPITER_TOKEN_API,
      reason: markets ? null : "The catalog-wide market read failed.",
      role: "On-chain price, pooled liquidity, 24h volume and holders, per mint",
    },
    ...issuerProfiles.map((profile) => {
      const disclosure = published[profile.id];
      return {
        id: profile.id,
        label: `${profile.label} API`,
        status: disclosure.status,
        url: profile.apiUrl,
        reason: disclosure.reason,
        role:
          profile.id === "xstocks"
            ? "Token catalog, chains, trading hours and proof of reserves"
            : profile.id === "backpack"
              ? "Listed securities, Solana tokens and whether each may move onchain"
              : "Token catalog, addresses and underlying market status",
      };
    }),
    /* Folded across all three issuers, not read off the first. Token Terminal
       may list one issuer's mints and none of another's, and taking xStocks'
       answer alone would print "unavailable" above panels showing live Token
       Terminal figures for the other two. */
    (() => {
      const external = issuers.map((issuer) => issuer.external).filter((value) => value !== null);
      const available = external.find((value) => value!.status === "available");
      const fallback = external[0];
      return {
        id: "tokenterminal",
        label: "Token Terminal",
        status:
          available?.status ??
          fallback?.status ??
          (tokenTerminalApiKey() ? "unavailable" : "not_configured"),
        url: TOKEN_TERMINAL.explorerUrl,
        reason: available ? null : (fallback?.reason ?? null),
        role: "Independent asset-level market cap, holders and transfer volume",
      } satisfies IssuerSourceStatus;
    })(),
  ];

  return {
    issuers,
    sources,
    totals: {
      companies: issuers.reduce((total, issuer) => total + issuer.catalog.companies, 0),
      representations: issuers.reduce((total, issuer) => total + issuer.catalog.representations, 0),
      tradedMints: issuers.reduce((total, issuer) => total + issuer.market.tradedMints, 0),
      volume24hUsd: sum(issuers.map((issuer) => issuer.market.volume24hUsd)),
      liquidityUsd: sum(issuers.map((issuer) => issuer.market.liquidityUsd)),
      holders: sum(issuers.map((issuer) => issuer.market.holders)),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The comparison the Markets overview shows: one row per issuer, volume and
 * liquidity against the mints they came from. Cheap — the catalog pass only.
 */
export async function issuerComparison(options: { fetch?: typeof fetch; fresh?: boolean } = {}) {
  const markets = await issuerMarkets(options);
  return {
    issuers: issuerProfiles.map((profile) => ({
      profile,
      catalog: issuerCatalog(profile.id),
      market: markets[profile.id],
    })),
    generatedAt: new Date().toISOString(),
  };
}

export type IssuerComparison = Awaited<ReturnType<typeof issuerComparison>>;
export { XSTOCKS_API, BACKPACK_API, ONDO_API };


function disclosureRole(id: IssuerId) {
  if (id === "xstocks") return "Token catalog, chains, trading hours and proof of reserves";
  if (id === "backpack") return "Listed securities, Solana tokens and whether each may move onchain";
  return "Token catalog, addresses and underlying market status";
}

async function disclosureFor(id: IssuerId, options: { fetch?: typeof fetch; fresh?: boolean }) {
  if (id === "xstocks") return xstocksDisclosure(options);
  if (id === "backpack") return backpackDisclosure();
  return ondoDisclosure(options);
}

/**
 * One issuer's profile page.
 *
 * Reads only what that issuer needs: the shared catalog pass, its own API and
 * — where a key exists — Token Terminal. The other two issuers are named so a
 * reader can move between profiles without a menu, but nothing of theirs is
 * fetched.
 */
export async function issuerSnapshot(
  id: IssuerId,
  options: { fetch?: typeof fetch; fresh?: boolean; external?: boolean } = {},
): Promise<IssuerProfileData | null> {
  const profile = issuerProfile(id);
  if (!profile) return null;
  const wantsExternal = options.external ?? Boolean(tokenTerminalApiKey());
  const [market, disclosure, external] = await Promise.all([
    catalogMarket(options)
      .then((pass) => aggregateIssuerMarket(id, pass))
      .catch(() => null),
    disclosureFor(id, options),
    wantsExternal ? issuerExternalCoverage(id, options).catch(() => null) : Promise.resolve(null),
  ]);
  const catalog = issuerCatalog(id);
  const sources: IssuerSourceStatus[] = [
    {
      id: "henar",
      label: "Henar registry",
      status: "available",
      url: null,
      reason: null,
      role: "Verified mints grouped by company, with this issuer's own source recorded",
    },
    {
      id: "jupiter",
      label: "Jupiter",
      status: market?.status === "available" ? "available" : "unavailable",
      url: JUPITER_TOKEN_API,
      reason: market?.reason ?? null,
      role: "Onchain price, pooled liquidity, 24h volume and holders, per mint",
    },
    {
      id,
      label: `${profile.label} API`,
      status: disclosure.status,
      url: profile.apiUrl,
      reason: disclosure.reason,
      role: disclosureRole(id),
    },
    {
      id: "tokenterminal",
      label: "Token Terminal",
      status: external?.status ?? (tokenTerminalApiKey() ? "unavailable" : "not_configured"),
      url: TOKEN_TERMINAL.explorerUrl,
      reason: external?.reason ?? null,
      role: "Independent asset-level market cap, holders and transfer volume",
    },
  ];
  return {
    profile,
    catalog,
    market:
      market ??
      ({
        status: "unavailable",
        mintsQueried: catalog.representations,
        mintsWithMarket: 0,
        tradedMints: 0,
        pricedMints: 0,
        mintsWithLiquidity: 0,
        volume24hUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        holders: null,
        traders24h: null,
        top: [],
        reason: "The onchain market source could not be read.",
        provenance: {
          source: "Jupiter",
          provider: "jupiter",
          sourceType: "dex-index",
          observedAt: new Date().toISOString(),
          url: JUPITER_TOKEN_API,
        },
      } as IssuerSnapshot["market"]),
    disclosure,
    external,
    sources,
    peers: issuerProfiles
      .filter((peer) => peer.id !== id)
      .map((peer) => ({ id: peer.id, label: peer.label, logo: peer.logo })),
    generatedAt: new Date().toISOString(),
  };
}
