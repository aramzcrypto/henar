/**
 * Matching Henar's verified mints to Token Terminal's asset catalog.
 *
 * The match is made on the token address Token Terminal publishes, never on a
 * symbol. Two issuers tokenize NVIDIA under symbols one character apart, and
 * a symbol match would confidently attribute one issuer's market cap to
 * another's token. A Solana mint address is unambiguous, so it is the only
 * key used; the chain ids and issuing projects that come back are recorded as
 * evidence rather than used to decide the match.
 */
import { createReadCache } from "@/lib/read-cache";
import { equityForMint } from "@/lib/equities/registry";
import { issuerRepresentations } from "@/lib/issuers/profiles";
import { ISSUER_IDS, type IssuerId } from "@/lib/issuers/types";
import {
  fetchAssetBreakdown,
  fetchAssets,
  TokenTerminalError,
  type TokenTerminalAsset,
  type TokenTerminalOptions,
} from "./client";
import { TOKEN_TERMINAL_CACHE, TOKEN_TERMINAL_METRICS } from "./config";
import type { TokenTerminalAssetMetrics, TokenTerminalMatch } from "./types";

/** Index a catalog by token address. One asset may carry many addresses. */
export function indexByAddress(assets: TokenTerminalAsset[]): Map<string, TokenTerminalAsset> {
  const index = new Map<string, TokenTerminalAsset>();
  for (const asset of assets)
    for (const address of asset.addresses ?? []) {
      if (!address.token_address) continue;
      /* First write wins: a later duplicate of the same address would be the
         same token, and overwriting it could swap a match for no reason. */
      if (!index.has(address.token_address)) index.set(address.token_address, asset);
    }
  return index;
}

export function matchMints(mints: string[], index: Map<string, TokenTerminalAsset>): TokenTerminalMatch[] {
  return mints.flatMap((mint) => {
    const asset = index.get(mint);
    if (!asset) return [];
    return [
      {
        mint,
        assetId: asset.asset_id,
        symbol: asset.symbol ?? null,
        name: asset.name ?? null,
        assetType: asset.asset_type ?? null,
        referenceAssetId: asset.reference_asset_id ?? null,
        chains: [...new Set((asset.addresses ?? []).flatMap((a) => (a.chain_id ? [a.chain_id] : [])))],
        issuers: (asset.products ?? []).flatMap((product) =>
          product.data_id ? [{ projectId: product.data_id, relation: product.relation_to_the_project ?? null }] : [],
        ),
      },
    ];
  });
}

const catalogCache = createReadCache<TokenTerminalAsset[]>(TOKEN_TERMINAL_CACHE.assetsMs, 2, {
  staleWhileRevalidate: true,
});

/**
 * Token Terminal's asset catalog. Throws a typed error when unreadable.
 *
 * The cache holds one catalog, because a deployment has one key. A caller
 * that supplies its own key or its own fetch — a test, or a probe against a
 * second credential — is asking about a different catalog, so it bypasses the
 * cache rather than reading or poisoning the shared one.
 */
export async function tokenTerminalCatalog(options: TokenTerminalOptions & { fresh?: boolean } = {}) {
  const ambient = options.apiKey === undefined && options.fetch === undefined;
  if (!ambient) return fetchAssets({}, options);
  return catalogCache("assets", () => fetchAssets({}, options), options.fresh);
}

/** Every Henar mint that Token Terminal lists, keyed by issuer. */
export async function matchesByIssuer(
  options: TokenTerminalOptions & { fresh?: boolean } = {},
): Promise<Record<IssuerId, TokenTerminalMatch[]>> {
  const index = indexByAddress(await tokenTerminalCatalog(options));
  return Object.fromEntries(
    ISSUER_IDS.map((id) => [
      id,
      matchMints(
        issuerRepresentations(id).map((representation) => representation.mint),
        index,
      ),
    ]),
  ) as Record<IssuerId, TokenTerminalMatch[]>;
}

function latest(row: { metrics?: Record<string, { latest?: number | null }> | null }, metric: string) {
  const value = row.metrics?.[metric]?.latest;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Asset metrics for a set of matched assets, in one breakdown call.
 *
 * The breakdown endpoint is grouped by asset and filtered to the ids asked
 * for, which is one request for a whole issuer rather than one per token. A
 * metric the key cannot read comes back absent, and absent stays null.
 */
export async function assetMetrics(
  assetIds: string[],
  options: TokenTerminalOptions & { interval?: string } = {},
): Promise<TokenTerminalAssetMetrics[]> {
  if (!assetIds.length) return [];
  const rows = await fetchAssetBreakdown(
    assetIds[0],
    {
      assetIds,
      metricIds: [
        TOKEN_TERMINAL_METRICS.marketCap,
        TOKEN_TERMINAL_METRICS.holders,
        TOKEN_TERMINAL_METRICS.transferVolume,
        TOKEN_TERMINAL_METRICS.price,
      ],
      interval: options.interval ?? "24h",
    },
    options,
  );
  return rows.flatMap((row) =>
    row.asset_id
      ? [
          {
            assetId: row.asset_id,
            marketCapUsd: latest(row, TOKEN_TERMINAL_METRICS.marketCap),
            holders: latest(row, TOKEN_TERMINAL_METRICS.holders),
            transferVolumeUsd: latest(row, TOKEN_TERMINAL_METRICS.transferVolume),
            priceUsd: latest(row, TOKEN_TERMINAL_METRICS.price),
          },
        ]
      : [],
  );
}

/** The company a matched mint belongs to, for display beside a Token Terminal row. */
export function companyForMatch(match: TokenTerminalMatch) {
  return equityForMint(match.mint)?.equity ?? null;
}

export { TokenTerminalError };
