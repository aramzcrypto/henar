/**
 * Token Terminal coverage, measured rather than assumed.
 *
 * The same shape as the Pyth coverage surface, and for the same reason: what
 * a key can read is a runtime fact. With no key the page says so and reports
 * nothing else; with a key it reports how much of Henar's verified universe
 * Token Terminal actually lists, per issuer, and which metrics came back.
 * A wider plan widens the numbers with no change here.
 */
import { createReadCache } from "@/lib/read-cache";
import { provenance } from "@/lib/provenance";
import { issuerRepresentations } from "@/lib/issuers/profiles";
import { ISSUER_IDS, type IssuerId, type IssuerExternalCoverage, type IssuerMeasure } from "@/lib/issuers/types";
import { assetMetrics, indexByAddress, matchMints, tokenTerminalCatalog } from "./assets";
import { TokenTerminalError, type TokenTerminalOptions } from "./client";
import { TOKEN_TERMINAL, TOKEN_TERMINAL_CACHE, tokenTerminalApiKey } from "./config";
import type { TokenTerminalAvailability, TokenTerminalCoverage, TokenTerminalMatch } from "./types";

export function availabilityFromError(error: unknown): TokenTerminalAvailability {
  if (!(error instanceof TokenTerminalError)) return "UNAVAILABLE";
  if (error.kind === "MISSING_KEY") return "NOT_CONFIGURED";
  if (error.kind === "INVALID_KEY") return "INVALID_KEY";
  if (error.kind === "NOT_ENTITLED") return "NOT_ENTITLED";
  if (error.kind === "RATE_LIMITED") return "RATE_LIMITED";
  return "UNAVAILABLE";
}

const NOT_CONFIGURED_DETAIL =
  "Token Terminal's REST API is on its API plan; the free plan covers the Explorer, Sheets and MCP but issues no REST key. Set TOKENTERMINAL_API_KEY to switch this on.";

function emptyByIssuer(matched: number | null) {
  return Object.fromEntries(
    ISSUER_IDS.map((id) => [id, { mints: issuerRepresentations(id).length, matched }]),
  ) as TokenTerminalCoverage["byIssuer"];
}

function sourceProvenance(observedAt: string) {
  return provenance({
    source: "Token Terminal",
    provider: "tokenterminal",
    sourceType: "research",
    observedAt,
    url: TOKEN_TERMINAL.explorerUrl,
  });
}

const cache = createReadCache<TokenTerminalCoverage>(TOKEN_TERMINAL_CACHE.coverageMs, 2, {
  staleWhileRevalidate: true,
});

export async function tokenTerminalCoverage(
  options: TokenTerminalOptions & { fresh?: boolean } = {},
): Promise<TokenTerminalCoverage> {
  const key = options.apiKey === undefined ? tokenTerminalApiKey() : options.apiKey;
  const checkedAt = new Date().toISOString();
  const mintsQueried = ISSUER_IDS.reduce((total, id) => total + issuerRepresentations(id).length, 0);
  if (!key)
    return {
      status: "NOT_CONFIGURED",
      keyConfigured: false,
      detail: NOT_CONFIGURED_DETAIL,
      catalogAssets: null,
      mintsMatched: null,
      mintsQueried,
      byIssuer: emptyByIssuer(null),
      referenceAssets: [],
      metricsAvailable: [],
      checkedAt,
      provenance: sourceProvenance(checkedAt),
    };
  const ambient = options.apiKey === undefined && options.fetch === undefined;
  const measure = async () => {
      try {
        const assets = await tokenTerminalCatalog(options);
        const index = indexByAddress(assets);
        const byIssuer = {} as TokenTerminalCoverage["byIssuer"];
        const all: TokenTerminalMatch[] = [];
        for (const id of ISSUER_IDS) {
          const mints = issuerRepresentations(id).map((representation) => representation.mint);
          const matches = matchMints(mints, index);
          byIssuer[id] = { mints: mints.length, matched: matches.length };
          all.push(...matches);
        }
        /* Which metrics this key actually returns, probed on the matched
           assets rather than declared from the documentation. */
        let metricsAvailable: string[] = [];
        if (all.length) {
          const probe = await assetMetrics(all.slice(0, 25).map((match) => match.assetId), options).catch(() => []);
          const present = new Set<string>();
          for (const row of probe) {
            if (row.marketCapUsd !== null) present.add("market cap");
            if (row.holders !== null) present.add("holders");
            if (row.transferVolumeUsd !== null) present.add("transfer volume");
            if (row.priceUsd !== null) present.add("price");
          }
          metricsAvailable = [...present];
        }
        return {
          status: "AVAILABLE" as const,
          keyConfigured: true,
          detail: `key accepted; ${all.length} of ${mintsQueried} verified mints are listed as assets`,
          catalogAssets: assets.length,
          mintsMatched: all.length,
          mintsQueried,
          byIssuer,
          referenceAssets: [
            ...new Set(all.flatMap((match) => (match.referenceAssetId ? [match.referenceAssetId] : []))),
          ].sort(),
          metricsAvailable,
          checkedAt,
          provenance: sourceProvenance(checkedAt),
        };
      } catch (error) {
        return {
          status: availabilityFromError(error),
          keyConfigured: true,
          detail: error instanceof TokenTerminalError ? error.message : "Token Terminal is unavailable.",
          catalogAssets: null,
          mintsMatched: null,
          mintsQueried,
          byIssuer: emptyByIssuer(null),
          referenceAssets: [],
          metricsAvailable: [],
          checkedAt,
          provenance: sourceProvenance(checkedAt),
        };
      }
  };
  /* The surface answers "what can this key read". Serving one credential's
     entitlement from another's cached answer would make it say the opposite
     of the truth, so only the ambient key uses the shared cache. */
  if (!ambient) return measure();
  return cache("coverage", measure, options.fresh);
}

function total(values: (number | null)[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

/** Token Terminal's own view of one issuer's tokens, for the issuer page. */
export async function issuerExternalCoverage(
  id: IssuerId,
  options: TokenTerminalOptions & { fresh?: boolean } = {},
): Promise<IssuerExternalCoverage> {
  const key = options.apiKey === undefined ? tokenTerminalApiKey() : options.apiKey;
  const observedAt = new Date().toISOString();
  const mints = issuerRepresentations(id).map((representation) => representation.mint);
  const base = {
    source: "Token Terminal",
    sourceUrl: TOKEN_TERMINAL.explorerUrl,
    mintsQueried: mints.length,
    provenance: sourceProvenance(observedAt),
  };
  if (!key)
    return { ...base, status: "not_configured" as const, mintsMapped: 0, measures: [], reason: NOT_CONFIGURED_DETAIL };
  try {
    const index = indexByAddress(await tokenTerminalCatalog(options));
    const matches = matchMints(mints, index);
    if (!matches.length)
      return {
        ...base,
        status: "unavailable" as const,
        mintsMapped: 0,
        measures: [],
        reason: "Token Terminal lists none of this issuer's verified mints as an asset.",
      };
    /* Two verified mints can be two addresses of one Token Terminal asset, so
       the ids are deduped before they are summed. */
    const assetIds = [...new Set(matches.map((match) => match.assetId))];
    const metrics = await assetMetrics(assetIds, options).catch(() => []);
    const references = [...new Set(matches.flatMap((m) => (m.referenceAssetId ? [m.referenceAssetId] : [])))];
    const measures: IssuerMeasure[] = [
      { id: "ttAssets", label: "Listed as assets", value: assetIds.length, unit: "count", detail: `of ${mints.length} verified mints` },
      { id: "ttMarketCap", label: "Market cap", value: total(metrics.map((m) => m.marketCapUsd)), unit: "usd" },
      { id: "ttHolders", label: "Holders", value: total(metrics.map((m) => m.holders)), unit: "count" },
      { id: "ttTransferVolume", label: "Transfer volume, 24h", value: total(metrics.map((m) => m.transferVolumeUsd)), unit: "usd" },
      {
        id: "ttReference",
        label: "Reference assets tracked",
        value: references.length,
        unit: "count",
        detail: references.slice(0, 5).join(", ") || null,
      },
    ];
    return { ...base, status: "available" as const, mintsMapped: matches.length, measures, reason: null };
  } catch (error) {
    return {
      ...base,
      status: "unavailable" as const,
      mintsMapped: 0,
      measures: [],
      reason: error instanceof TokenTerminalError ? error.message : "Token Terminal is unavailable.",
    };
  }
}
