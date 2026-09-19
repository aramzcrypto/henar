export { POOL_TYPE_LABELS, type EarnPool } from "./pool-types";
import type { EarnPool } from "./pool-types";
import { loadStockEarnCatalog } from "./catalog";

/**
 * A pool is anything a user can deposit into from Henar's Earn surface. The
 * featured USDC strategy is the only one wired to the protocol today; the rest
 * are verified markets whose integration is not built yet.
 */

export const FEATURED_SLUG = "usdc-stocks";

/** The live, protocol-wired strategy. APY and TVL come from the protocol view. */
export const FEATURED_POOL: EarnPool = {
  slug: FEATURED_SLUG,
  name: "Earn stocks",
  summary:
    "Deposit USDC, earn yield, and direct that yield into stocks or Packs.",
  protocol: "Kamino",
  type: "usdc-strategy",
  depositAsset: "USDC",
  ticker: null,
  company: null,
  companyLogo: null,
  representation: null,
  provider: null,
  apy: null,
  tvlUsd: null,
  status: "live",
  sourceUrl: null,
  externalUrl: null,
};

function slugFor(ticker: string, protocol: string, type: string) {
  return `${ticker}-${protocol}-${type}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Verified stock pools. Only markets that actually hold value are listed, so a
 * reserve that exists on paper but has no deposits is left out.
 */
export async function loadEarnPools(): Promise<{
  pools: EarnPool[];
  notes: { protocol: string; reason: string | null }[];
}> {
  const catalog = await loadStockEarnCatalog();
  const pools = catalog.opportunities
    .filter((item) => (item.tvlUsd ?? 0) > 0)
    .map((item): EarnPool => ({
      slug: slugFor(item.ticker, item.protocol, item.type),
      name: `${item.ticker} ${item.protocol}`,
      summary: `Supply ${item.representation} to the ${item.protocol} ${
        item.type === "lending" ? "lending market" : "vault"
      }.`,
      protocol: item.protocol,
      type: item.type,
      depositAsset: item.representation,
      ticker: item.ticker,
      company: item.company,
      companyLogo: item.companyLogo,
      representation: item.representation,
      provider: item.provider,
      apy: item.apy,
      tvlUsd: item.tvlUsd,
      // Henar reads these live but does not route deposits yet.
      status: "coming_soon",
      sourceUrl: item.sourceUrl,
      externalUrl: item.destinationUrl,
    }));

  return {
    pools,
    notes: catalog.protocols
      .filter((item) => item.status === "unavailable")
      .map((item) => ({ protocol: item.protocol, reason: item.reason })),
  };
}

export async function findEarnPool(slug: string): Promise<EarnPool | null> {
  if (slug === FEATURED_SLUG) return FEATURED_POOL;
  const { pools } = await loadEarnPools();
  return pools.find((pool) => pool.slug === slug) ?? null;
}

