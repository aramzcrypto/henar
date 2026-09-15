/* The Market fee. Swaps are wallet-signed with the fee attached as a plain
   transfer, so this constant is the whole story for that path; the protocol
   fee on Limit, DCA and position flows is separate program state
   (ConfigTerms.trade_fee_bps) and is not changed by editing this. */
export const MARKET_FEE_BPS = 15;

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
