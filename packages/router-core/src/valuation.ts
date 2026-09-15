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
