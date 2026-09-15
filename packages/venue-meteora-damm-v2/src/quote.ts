/**
 * DAMM v2 quoting — pure wrapper over the official `swapQuoteExactInput`.
 * The SDK computes output, fees, next sqrt price and price impact; this
 * module only fixes the direction and carries results as bigint.
 *
 * Token-2022 transfer fees: the SDK accepts `inputTokenInfo`/
 * `outputTokenInfo` to net fee-on-transfer. The adapter refuses mints with a
 * non-zero transfer fee (router policy, see token-extensions), so those
 * arguments are intentionally not passed: a quote here never depends on a
 * transfer-fee assumption.
 */
import BN from "bn.js";
import type { PoolState } from "./state";

export type DammV2QuoteInput = {
  pool: PoolState;
  /** True when swapping token A for token B. */
  aToB: boolean;
  amountIn: bigint;
  currentPoint: bigint;
  tokenADecimals: number;
  tokenBDecimals: number;
};

export type DammV2QuoteComputation = {
  includedFeeInputAmount: bigint;
  excludedFeeInputAmount: bigint;
  amountLeft: bigint;
  outputAmount: bigint;
  claimingFee: bigint;
  protocolFee: bigint;
  compoundingFee: bigint;
  referralFee: bigint;
  nextSqrtPrice: bigint;
  /** From the SDK's Decimal (percent); floor to integer bps. */
  priceImpactBps: number | null;
};

type SdkQuote = typeof import("@meteora-ag/cp-amm-sdk").swapQuoteExactInput;

export function quoteDammV2ExactIn(input: DammV2QuoteInput, swapQuoteExactInput: SdkQuote): DammV2QuoteComputation {
  const result = swapQuoteExactInput(
    input.pool,
    new BN(input.currentPoint.toString()),
    new BN(input.amountIn.toString()),
    0,
    input.aToB,
    false,
    input.tokenADecimals,
    input.tokenBDecimals,
  );
  const b = (v: BN | undefined) => BigInt((v ?? new BN(0)).toString());
  let priceImpactBps: number | null = null;
  try {
    const pct = Number(result.priceImpact.toString());
    priceImpactBps = Number.isFinite(pct) ? Math.floor(pct * 100) : null;
  } catch {
    priceImpactBps = null;
  }
  return {
    includedFeeInputAmount: b(result.includedFeeInputAmount),
    excludedFeeInputAmount: b(result.excludedFeeInputAmount),
    amountLeft: b(result.amountLeft),
    outputAmount: b(result.outputAmount),
    claimingFee: b(result.claimingFee),
    protocolFee: b(result.protocolFee),
    compoundingFee: b(result.compoundingFee),
    referralFee: b(result.referralFee),
    nextSqrtPrice: b(result.nextSqrtPrice),
    priceImpactBps,
  };
}
