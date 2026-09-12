import type { ProtocolView } from "./protocol/view";
export type StockReceipt = {
  address: string;
  mint?: string;
  units?: string;
  value?: string;
  source: "Yield" | "Pack" | "Yield pack";
};
/** Receipts are historical, never a substitute for current wallet balances. */
export function stockReceipts(
  data: ProtocolView | null,
  owner?: string,
): StockReceipt[] {
  if (!data || !owner) return [];
  const supported = new Set(data.stocks.map((s) => s.mint));
  const receipts: StockReceipt[] = [];
  for (const p of data.positions) {
    // Earn preferences can change stock mints. The cumulative counter cannot safely
    // be attributed to the current target; report verified USDC spent instead.
    if (
      p.owner === owner &&
      "earn" in p.kind &&
      BigInt(p.stockUsdcSpent) > 0n &&
      BigInt(p.stockUnitsReceived) > 0n
    )
      receipts.push({
        address: p.address,
        value: p.stockUsdcSpent,
        source: "Yield",
      });
  }
  for (const p of data.packs) {
    if (
      p.owner === owner &&
      p.stockMint &&
      supported.has(p.stockMint) &&
      "settled" in p.status &&
      BigInt(p.unitsReceived) > 0n
    )
      receipts.push({
        address: p.address,
        mint: p.stockMint,
        units: p.unitsReceived,
        source: "earned" in p.source ? "Yield pack" : "Pack",
      });
  }
  return receipts;
}
