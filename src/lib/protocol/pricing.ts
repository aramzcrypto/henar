export type OraclePrice = {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
};
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function stockDelivery(
  budget: bigint,
  stock: OraclePrice,
  usdc: OraclePrice,
  ratioNumerator: bigint,
  ratioDenominator: bigint,
  decimals: number,
  slippageBps: number,
  now: number,
  maxAge: number,
  maxConfidenceBps: number,
  limit?: bigint,
  multiplier = 1,
) {
  for (const p of [stock, usdc]) {
    if (
      BigInt(p.price) <= 0n ||
      BigInt(p.conf) < 0n ||
      !Number.isInteger(p.expo) ||
      p.expo > 0 ||
      p.expo < -12 ||
      p.publish_time > now ||
      now - p.publish_time > maxAge ||
      BigInt(p.conf) * 10000n > BigInt(p.price) * BigInt(maxConfidenceBps)
    )
      throw new Error("Oracle is stale, uncertain, or unavailable.");
  }
  if (
    budget <= 0n ||
    ratioNumerator <= 0n ||
    ratioDenominator <= 0n ||
    decimals < 0 ||
    decimals > 12 ||
    !Number.isInteger(decimals) ||
    slippageBps < 0 ||
    slippageBps > 100
  )
    throw new Error("Invalid settlement terms.");
  const denominator =
    (BigInt(usdc.price) - BigInt(usdc.conf)) *
    10n ** BigInt(-stock.expo) *
    ratioDenominator;
  if (denominator <= 0n) throw new Error("Invalid USDC price.");
  const unscaled = ceil(
    (BigInt(stock.price) + BigInt(stock.conf)) *
      10n ** BigInt(-usdc.expo) *
      1000000n *
      ratioNumerator,
    denominator,
  );
  const price = scaledPrice(unscaled, multiplier);
  if (limit !== undefined && unscaled > limit)
    throw new Error("Limit price has not been reached.");
  const cap = ceil(price * BigInt(10000 + slippageBps), 10000n);
  const rawLimit =
    limit === undefined ? undefined : scaledPrice(limit, multiplier);
  const actualCap = rawLimit !== undefined && rawLimit < cap ? rawLimit : cap;
  return { price, minimum: ceil(budget * 10n ** BigInt(decimals), actualCap) };
}
export function scaledPrice(price: bigint, multiplier: number): bigint {
  const data = new ArrayBuffer(8),
    view = new DataView(data);
  view.setFloat64(0, multiplier, true);
  const bits = view.getBigUint64(0, true);
  const exponent = Number((bits >> 52n) & 2047n);
  if (bits >> 63n || exponent === 0 || exponent === 2047)
    throw new Error("Invalid stock multiplier.");
  const mantissa = (bits & ((1n << 52n) - 1n)) | (1n << 52n),
    shift = exponent - 1023 - 52;
  return shift >= 0
    ? price * mantissa * (1n << BigInt(shift))
    : ceil(price * mantissa, 1n << BigInt(-shift));
}
/** Presentation only: format raw stock units using the multiplier recorded at settlement. */
export function displayStockUnits(
  amount: bigint,
  bits: bigint,
  decimals: number,
): string {
  const exponent = Number((bits >> 52n) & 2047n),
    mantissa = (bits & ((1n << 52n) - 1n)) | (1n << 52n);
  if (
    bits >> 63n ||
    exponent === 0 ||
    exponent === 2047 ||
    decimals < 0 ||
    decimals > 12
  )
    throw new Error("Invalid stock units.");
  const shift = exponent - 1023 - 52;
  const numerator = amount * mantissa * (shift >= 0 ? 1n << BigInt(shift) : 1n);
  const denominator =
    10n ** BigInt(decimals) * (shift < 0 ? 1n << BigInt(-shift) : 1n);
  const whole = numerator / denominator,
    fraction = ((numerator % denominator) * 1000000000000n) / denominator;
  const tail = fraction.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole}${tail ? `.${tail}` : ""}`;
}
