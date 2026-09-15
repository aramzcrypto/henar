/**
 * Pool valuation.
 *
 * A concentrated-liquidity pool is not balanced. Doubling the USDC vault to
 * estimate TVL assumes the two sides hold equal value, which is true of a
 * constant-product pool at its price and false of a Whirlpool whose range may
 * sit entirely on one side of the market — it understates a stock-heavy pool
 * and overstates a USDC-heavy one, in both cases by an unbounded factor.
 *
 * So each side is valued on its own: the USDC vault at face, the stock vault
 * at a verified reference price.
 *
 * Token-2022 Scaled UI Amount matters here. The vault holds a raw amount that
 * never changes on a dividend or split; the multiplier is what converts it to
 * the units a reference price is quoted in. Valuation therefore applies the
 * multiplier, while settlement continues to use raw amounts — the two must not
 * be confused, which is why the multiplier is a named input rather than a
 * silent default.
 *
 * Without a trustworthy reference price there is no honest number to report.
 * The valuation is UNAVAILABLE and the caller keeps the pool disabled; it is
 * never filled in with a guess.
 */

export type PoolValuationMethod =
  | "USDC_VAULT_PLUS_STOCK_AT_REFERENCE"
  | "BOTH_SIDES_AT_REFERENCE"
  | "UNAVAILABLE";

export type PoolValuation = {
  tvlUsd: number | null;
  method: PoolValuationMethod;
  /** Why a valuation is unavailable, or what went into one that is not. */
  detail: string;
};

export type WhirlpoolValuationInput = {
  /** Raw USDC vault balance, 6 decimals. */
  usdcRawAmount: bigint;
  /** Raw stock vault balance, in the mint's own decimals. */
  stockRawAmount: bigint;
  stockDecimals: number | null;
  /** Scaled UI Amount multiplier; exactly 1 for a plain SPL mint. */
  scaledUiMultiplier: number;
  /** Verified reference price per display unit, in USD. */
  referencePriceUsd: number | null;
};

const USDC_DECIMALS = 6;

export function valueWhirlpool(input: WhirlpoolValuationInput): PoolValuation {
  const { usdcRawAmount, stockRawAmount, stockDecimals, scaledUiMultiplier, referencePriceUsd } =
    input;

  if (stockDecimals === null || !Number.isInteger(stockDecimals) || stockDecimals < 0)
    return {
      tvlUsd: null,
      method: "UNAVAILABLE",
      detail: "stock mint decimals unverified",
    };
  if (referencePriceUsd === null || !Number.isFinite(referencePriceUsd) || referencePriceUsd <= 0)
    return {
      tvlUsd: null,
      method: "UNAVAILABLE",
      detail: "no verified reference price for the stock side",
    };
  if (!Number.isFinite(scaledUiMultiplier) || scaledUiMultiplier <= 0)
    return {
      tvlUsd: null,
      method: "UNAVAILABLE",
      detail: "scaled UI multiplier is not a positive number",
    };

  const usdcValue = Number(usdcRawAmount) / 10 ** USDC_DECIMALS;
  // Raw -> display units -> USD. The multiplier belongs on this side only.
  const displayUnits = (Number(stockRawAmount) / 10 ** stockDecimals) * scaledUiMultiplier;
  const stockValue = displayUnits * referencePriceUsd;
  const tvlUsd = usdcValue + stockValue;

  if (!Number.isFinite(tvlUsd))
    return {
      tvlUsd: null,
      method: "UNAVAILABLE",
      detail: "valuation overflowed",
    };

  return {
    tvlUsd,
    method: "USDC_VAULT_PLUS_STOCK_AT_REFERENCE",
    detail: `USDC $${usdcValue.toFixed(2)} + stock $${stockValue.toFixed(2)} at $${referencePriceUsd} x${scaledUiMultiplier}`,
  };
}

/**
 * A pool whose quote side is not USDC.
 *
 * Routing legs pair a representation with SOL or USDT, so neither side can be
 * taken at face value. Each is valued at its own verified price, on the same
 * terms as the USDC case: a side without a price makes the whole valuation
 * UNAVAILABLE rather than half a number, because half a pool's depth is not a
 * conservative estimate of the pool's depth, it is a wrong one.
 */
export type TwoSidedValuationInput = {
  a: { rawAmount: bigint; decimals: number | null; scaledUiMultiplier: number; priceUsd: number | null; label: string };
  b: { rawAmount: bigint; decimals: number | null; scaledUiMultiplier: number; priceUsd: number | null; label: string };
};

export function valueTwoSidedPool(input: TwoSidedValuationInput): PoolValuation {
  const sides = [input.a, input.b];
  for (const side of sides) {
    if (side.decimals === null || !Number.isInteger(side.decimals) || side.decimals < 0)
      return { tvlUsd: null, method: "UNAVAILABLE", detail: `${side.label} decimals unverified` };
    if (side.priceUsd === null || !Number.isFinite(side.priceUsd) || side.priceUsd <= 0)
      return { tvlUsd: null, method: "UNAVAILABLE", detail: `${side.label} has no verified price` };
    if (!Number.isFinite(side.scaledUiMultiplier) || side.scaledUiMultiplier <= 0)
      return { tvlUsd: null, method: "UNAVAILABLE", detail: `${side.label} scaled UI multiplier is not positive` };
  }
  const value = (side: TwoSidedValuationInput["a"]) => {
    const displayUnits = (Number(side.rawAmount) / 10 ** (side.decimals as number)) * side.scaledUiMultiplier;
    return displayUnits * (side.priceUsd as number);
  };
  const tvlUsd = value(input.a) + value(input.b);
  if (!Number.isFinite(tvlUsd) || tvlUsd < 0)
    return { tvlUsd: null, method: "UNAVAILABLE", detail: "valuation is not a finite non-negative number" };
  return {
    tvlUsd,
    method: "BOTH_SIDES_AT_REFERENCE",
    detail: `${input.a.label} ${value(input.a).toFixed(2)} + ${input.b.label} ${value(input.b).toFixed(2)}`,
  };
}
