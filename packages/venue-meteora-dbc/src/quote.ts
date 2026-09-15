/**
 * DBC quoting — a thin, pure wrapper over the official SDK's
 * `swapQuoteExactIn`. No curve arithmetic lives here: the SDK computes the
 * output, fees and next sqrt price; this module only decides direction,
 * carries the numbers as bigint, and derives price impact from the SDK's
 * own spot price.
 *
 * Conservative choices:
 *  - `eligibleForFirstSwapWithMinFee` is always false. If the pool would
 *    grant a min-fee first swap, the real output is higher than quoted; the
 *    reverse assumption could quote more than a user receives.
 *  - `hasReferral` is false: Henar takes its fee outside the venue.
 *  - slippage 0: the router owns slippage policy.
 */
import BN from "bn.js";
import type { PoolConfig, VirtualPool } from "./state";

export type DbcQuoteInput = {
  pool: VirtualPool;
  config: PoolConfig;
  /** True when selling the base (launch) token for the quote token. */
  swapBaseForQuote: boolean;
  amountIn: bigint;
  currentPoint: bigint;
};

export type DbcQuoteComputation = {
  includedFeeInputAmount: bigint;
  excludedFeeInputAmount: bigint;
  amountLeft: bigint;
  outputAmount: bigint;
  tradingFee: bigint;
  protocolFee: bigint;
  referralFee: bigint;
  nextSqrtPrice: bigint;
  /** Fee taken on the input side (true) or the output side (false). */
  feeOnInput: boolean;
  /** Spot-vs-execution impact in basis points, integer, floor. */
  priceImpactBps: number;
};

const Q128 = 1n << 128n;

/**
 * Impact relative to the pre-trade spot price, from the pool's sqrt price
 * (Q64.64). For quote→base, expected base at spot = in / price; for
 * base→quote, expected quote = in × price. Both are done in integers.
 */
export function dbcPriceImpactBps(
  sqrtPriceQ64: bigint,
  swapBaseForQuote: boolean,
  amountInAfterFee: bigint,
  outputBeforeFee: bigint,
) {
  if (amountInAfterFee <= 0n || outputBeforeFee <= 0n || sqrtPriceQ64 <= 0n) return 0;
  const priceQ128 = sqrtPriceQ64 * sqrtPriceQ64; // quote per base, Q128
  const expected = swapBaseForQuote
    ? (amountInAfterFee * priceQ128) / Q128
    : (amountInAfterFee * Q128) / priceQ128;
  if (expected <= 0n) return 0;
  if (outputBeforeFee >= expected) return 0;
  return Number(((expected - outputBeforeFee) * 10_000n) / expected);
}

type SdkQuote = typeof import("@meteora-ag/dynamic-bonding-curve-sdk").swapQuoteExactIn;

/**
 * Quote through the SDK. Throws the SDK's own errors ("Virtual pool is
 * completed", "Insufficient Liquidity", "Amount is zero") unchanged so the
 * adapter can map them to structured reasons.
 */
export function quoteDbcExactIn(input: DbcQuoteInput, swapQuoteExactIn: SdkQuote): DbcQuoteComputation {
  const result = swapQuoteExactIn(
    input.pool,
    input.config,
    input.swapBaseForQuote,
    new BN(input.amountIn.toString()),
    0,
    false,
    new BN(input.currentPoint.toString()),
    false,
  );
  const b = (v: BN | undefined) => BigInt((v ?? new BN(0)).toString());
  const includedFeeInputAmount = b(result.includedFeeInputAmount);
  const excludedFeeInputAmount = b(result.excludedFeeInputAmount);
  const outputAmount = b(result.outputAmount);
  const tradingFee = b(result.tradingFee);
  const protocolFee = b(result.protocolFee);
  const feeOnInput = excludedFeeInputAmount < includedFeeInputAmount;
  // Fees on output are already deducted from `outputAmount`; add them back
  // to measure the curve's own impact rather than fee plus impact.
  const grossOut = feeOnInput ? outputAmount : outputAmount + tradingFee + protocolFee + b(result.referralFee);
  return {
    includedFeeInputAmount,
    excludedFeeInputAmount,
    amountLeft: b(result.amountLeft),
    outputAmount,
    tradingFee,
    protocolFee,
    referralFee: b(result.referralFee),
    nextSqrtPrice: b(result.nextSqrtPrice),
    feeOnInput,
    priceImpactBps: dbcPriceImpactBps(
      BigInt(input.pool.poolState.sqrtPrice.toString()),
      input.swapBaseForQuote,
      excludedFeeInputAmount,
      grossOut,
    ),
  };
}
