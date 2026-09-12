import catalog from "@/data/stocks.json";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const issuers: Record<string, { issuer: string; disclosures: string }> = {
  xStocks: {
    issuer: "Backed Assets (JE) Limited",
    disclosures: "https://assets.backed.fi/legal-documentation",
  },
  Ondo: {
    issuer: "Ondo Global Markets (BVI) Limited",
    disclosures: "https://ondo.finance/ondo-stocks",
  },
  Backpack: {
    issuer: "Backpack Securities",
    disclosures:
      "https://learn.backpack.exchange/blog/introducing-backpack-securities",
  },
};
export const stocks = catalog.map((s) => ({
  ...s,
  ...issuers[s.provider],
  verifiedAt: "2026-09-12",
  enabled: true,
  oracleFeed: null,
  liquidityStatus: "Requires live quote",
  decimalsSource: "Validated from onchain mint at request time",
  tokenProgramSource: "Validated from onchain mint at request time",
}));
export type Stock = (typeof stocks)[number];
const byMint = new Map(stocks.map((s) => [s.mint, s]));
export function stockFor(mint: string) {
  const stock = byMint.get(mint);
  if (!stock?.enabled) throw new Error("Unsupported stock mint.");
  return stock;
}
