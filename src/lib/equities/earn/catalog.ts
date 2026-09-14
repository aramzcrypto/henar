import { equityForMint } from "../registry";
import { KAMINO_METRICS_URL, kaminoReserveSnapshot } from "./kamino";
import { vedaDiscovery } from "./veda";

/**
 * Normalized cross-catalog earn opportunity, per the Henar opportunity schema.
 * Every field is either a verified value or null. APY is never estimated.
 */
export type StockEarnOpportunity = {
  id: string;
  company: string;
  ticker: string;
  companyLogo: string | null;
  representation: string;
  provider: string;
  protocol: string;
  type: "lending" | "vault" | "liquidity_pool";
  apy: number | null;
  tvlUsd: number | null;
  /**
   * "live" means Henar executes it in-app. "external" means the opportunity is
   * verified and live on its own protocol but Henar does not route to it yet.
   * "coming_soon" means an integration is planned and nothing is claimed.
   */
  status: "live" | "external" | "coming_soon";
  source: string;
  sourceUrl: string;
  destinationUrl: string | null;
  lastUpdated: string | null;
};

export type EarnProtocolStatus = {
  protocol: string;
  status: "available" | "unavailable";
  reason: string | null;
};

export type StockEarnCatalog = {
  opportunities: StockEarnOpportunity[];
  protocols: EarnProtocolStatus[];
  asOf: string | null;
};

const TYPE_LABELS: Record<StockEarnOpportunity["type"], string> = {
  lending: "Lending",
  vault: "Vault",
  liquidity_pool: "LP",
};

export function earnTypeLabel(type: StockEarnOpportunity["type"]) {
  return TYPE_LABELS[type];
}

/**
 * Lists every Kamino xStocks reserve that maps onto a verified catalog mint.
 * Reserves that do not match a verified representation are dropped rather than
 * guessed at from a token symbol.
 */
export async function loadStockEarnCatalog(): Promise<StockEarnCatalog> {
  const veda = vedaDiscovery();
  const planned: EarnProtocolStatus[] = [
    ...veda.sources,
    {
      protocol: "Meteora",
      status: "unavailable",
      reason: "No verified stock-pair LP feed connected.",
    },
  ];

  try {
    const snapshot = await kaminoReserveSnapshot();
    const opportunities: StockEarnOpportunity[] = [];
    for (const reserve of snapshot.reserves) {
      const match = equityForMint(reserve.liquidityTokenMint);
      if (!match || match.representation.providerStatus !== "verified") continue;
      opportunities.push({
        id: `kamino:${reserve.reserve}`,
        company: match.equity.name,
        ticker: match.equity.ticker,
        companyLogo: match.equity.logo,
        representation: match.representation.tokenSymbol,
        provider: match.representation.provider,
        protocol: "Kamino",
        type: "lending",
        apy:
          reserve.supplyApy === null || reserve.supplyApy === undefined
            ? null
            : reserve.supplyApy * 100,
        tvlUsd: reserve.totalSupplyUsd ?? null,
        // The reserve exists and is measurable, but Henar does not route
        // deposits into it, so it is presented as an external opportunity.
        status: "external",
        source: "Kamino",
        sourceUrl: KAMINO_METRICS_URL,
        destinationUrl: "https://kamino.com/borrow?collateralPreset=xStocks",
        lastUpdated: snapshot.asOf,
      });
    }
    opportunities.sort(
      (a, b) =>
        (b.apy ?? -1) - (a.apy ?? -1) || a.ticker.localeCompare(b.ticker),
    );
    return {
      opportunities,
      protocols: [
        { protocol: "Kamino", status: "available", reason: null },
        ...planned,
      ],
      asOf: snapshot.asOf,
    };
  } catch {
    return {
      opportunities: [],
      protocols: [
        {
          protocol: "Kamino",
          status: "unavailable",
          reason: "Live reserve discovery is temporarily unavailable.",
        },
        ...planned,
      ],
      asOf: null,
    };
  }
}
