/* The Market fee. Swaps are wallet-signed with the fee attached as a plain
   transfer, so this constant is the whole story for that path; the protocol
   fee on Limit, DCA and position flows is separate program state
   (ConfigTerms.trade_fee_bps) and is not changed by editing this.

   10 bps, from 15. The 196-observation matrix showed Henar's own routing
   about 5 bps ahead of Jupiter gross at $10 through $10,000 while losing by
   10 bps net: the fee was larger than the entire routing edge, and at 0 bps
   the direct venues would have won 92, 75 and 65 percent of rows by size
   against 6, 4 and 11 percent at 15 bps. One constant serves the router
   engine and /api/market alike, so native and external routes are charged
   identically and neither can be charged twice. */
export const MARKET_FEE_BPS = 10;

export function tradeFee(amount: bigint, feeBps = MARKET_FEE_BPS) {
  return (amount * BigInt(feeBps)) / 10_000n;
}

export function grossForNet(net: bigint, feeBps = MARKET_FEE_BPS) {
  const denominator = 10_000n - BigInt(feeBps);
  let gross = (net * 10_000n) / denominator;
  while (gross - tradeFee(gross, feeBps) < net) gross += 1n;
  while (
    gross > 0n &&
    gross - 1n - tradeFee(gross - 1n, feeBps) >= net
  )
    gross -= 1n;
  return gross;
}
