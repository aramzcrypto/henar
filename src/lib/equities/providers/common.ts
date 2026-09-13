import type { Representation } from "../types";

export type CatalogEntry = {
  provider: "xStocks" | "Ondo" | "Backpack";
  ticker: string;
  name: string;
  mint: string;
  category: string;
  instrument: "Stock" | "ETF";
  source: string;
  logoSource: string;
  logo: string;
  underlying: string;
};

export type ProviderProfile = Pick<
  Representation,
  | "provider"
  | "providerLabel"
  | "issuer"
  | "issuerUrl"
  | "redemptionModel"
  | "dividendTreatment"
  | "transferRestrictions"
  | "corporateActionMechanism"
  | "defiSupport"
>;

export function normalizeRepresentation(
  entry: CatalogEntry,
  profile: ProviderProfile,
): Representation {
  const ticker = entry.underlying.trim().toUpperCase();
  return {
    id: `${profile.provider}:${entry.mint}`,
    equityId: `equity:${ticker}`,
    ...profile,
    tradeCapabilities: {
      dexSwap: false,
      rfq: false,
      primaryMint: false,
      primaryRedeem: false,
    },
    earnCapabilities: { lending: false, vault: false, liquidityPool: false },
    marketCapabilities: {
      secondaryTrading: false,
      primaryMarket: false,
      transfers: false,
      afterHoursTrading: false,
    },
    tokenSymbol: entry.ticker,
    mint: entry.mint,
    tokenProgram: null,
    decimals: null,
    providerStatus: "verified",
    tradingStatus: "unknown",
    sourceUrl: entry.source,
    verifiedAt: "2026-09-12",
    logo: entry.logo || null,
  };
}
