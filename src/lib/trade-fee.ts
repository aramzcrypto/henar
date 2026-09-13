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
