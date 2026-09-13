/** Fixed V1 terms. Mirrors stockroom_math::lucky_payout; amounts are USDC base units. */
export const LUCKY_OUTCOMES = [
  { quarters: 1n, probability: 4, label: "0.25×" },
  { quarters: 2n, probability: 20, label: "0.5×" },
  { quarters: 4n, probability: 64, label: "1×" },
  { quarters: 6n, probability: 8, label: "1.5×" },
  { quarters: 8n, probability: 4, label: "2×" },
] as const;
const U64_MAX = (1n << 64n) - 1n;
export function luckyPayout(stake: bigint, bucket: number) {
  if (
    stake <= 0n ||
    stake > U64_MAX ||
    !Number.isInteger(bucket) ||
    bucket < 0 ||
    bucket >= 100
  )
    throw new Error("Invalid Lucky stake or outcome.");
  let threshold = 0;
  for (const outcome of LUCKY_OUTCOMES) {
    threshold += outcome.probability;
    if (bucket < threshold) {
      const result = (stake * outcome.quarters) / 4n;
      if (result > U64_MAX) throw new Error("Lucky payout overflow.");
      return result;
    }
  }
  throw new Error("Invalid outcome.");
}
export function canReserveLucky(
  stake: bigint,
  reserve: bigint,
  maxStake: bigint,
) {
  return (
    stake > 0n && stake <= maxStake && stake <= U64_MAX / 2n && reserve >= stake
  );
}
