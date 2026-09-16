/**
 * Henar's asset taxonomy.
 *
 * Public tokenized equities and ETFs keep their existing `Equity` model;
 * private-market exposure products (PreStocks, Tessera) are a separate class
 * with their own company model. The classes are disjoint on purpose: a
 * PreStocks token is not a share of the referenced company, and a Tessera
 * T-Token is not a PreStocks token, whatever company both mention.
 */
export const ASSET_CLASSES = ["CRYPTO", "PUBLIC_EQUITY", "ETF", "PRIVATE_MARKET_EXPOSURE"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  CRYPTO: "Crypto",
  PUBLIC_EQUITY: "Stock",
  ETF: "ETF",
  PRIVATE_MARKET_EXPOSURE: "Pre-IPO exposure",
};

/** Public equities keep the registry's stock/etf split. */
export function publicAssetClass(assetType: "stock" | "etf"): AssetClass {
  return assetType === "etf" ? "ETF" : "PUBLIC_EQUITY";
}

export function isPrivateMarketClass(assetClass: AssetClass | null | undefined) {
  return assetClass === "PRIVATE_MARKET_EXPOSURE";
}
