export function parseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Enter a valid amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places.`);
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (result > 18446744073709551615n) throw new Error("Amount is too large.");
  return result;
}
export function formatUnits(
  value: string | bigint,
  decimals: number,
  precision = decimals,
): string {
  const raw = BigInt(value);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const fraction = (abs % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, precision)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / scale}${fraction ? "." + fraction : ""}`;
}
export const feeFor = (amount: bigint, bps = 25) =>
  (amount * BigInt(bps)) / 10000n;
