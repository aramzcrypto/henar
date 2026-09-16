/**
 * Fee-profile model. MODELED — a starting point expressed only in the SDK's
 * `BaseFeeParams` scheduler terms (linear or exponential; never RateLimiter,
 * which is deprecated for new configs), validated by the SDK's
 * `getFeeSchedulerParams`.
 *
 * The heuristic: a launch starts with a higher fee that decays to the
 * steady-state fee, discouraging first-minute sniping; volatility raises the
 * steady-state fee and turns on the dynamic fee; thin liquidity raises the
 * steady-state fee a step further. Nothing here is calibrated to market
 * data.
 */
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";

export type FeeProfileInput = {
  expectedVolatility: "low" | "medium" | "high";
  liquidity: "thin" | "moderate" | "deep";
  maturity: "launch" | "established";
};

export type FeeProfileRecommendation =
  | {
      ok: true;
      modeled: true;
      label: "MODELED";
      mode: "linear" | "exponential";
      startingFeeBps: number;
      endingFeeBps: number;
      numberOfPeriod: number;
      /** Seconds (assumes ActivationType.Timestamp). */
      totalDuration: number;
      dynamicFeeEnabled: boolean;
      /** The SDK's `BaseFeeParams` for this profile. */
      baseFeeParams: dbc.BaseFeeParams;
      /** What `getFeeSchedulerParams` produced (on-chain form). */
      sdkBaseFee: dbc.BaseFee;
      rationale: Record<"mode" | "startingFeeBps" | "endingFeeBps" | "numberOfPeriod" | "totalDuration" | "dynamicFeeEnabled", string>;
    }
  | { ok: false; problems: string[] };

const STEADY_STATE_BPS: Record<FeeProfileInput["expectedVolatility"], number> = { low: 30, medium: 50, high: 100 };
const THIN_LIQUIDITY_STEP_BPS: Record<FeeProfileInput["liquidity"], number> = { thin: 50, moderate: 25, deep: 0 };

export function recommendFeeProfile(input: FeeProfileInput): FeeProfileRecommendation {
  const problems: string[] = [];
  if (!(input.expectedVolatility in STEADY_STATE_BPS)) problems.push("expectedVolatility must be low, medium or high");
  if (!(input.liquidity in THIN_LIQUIDITY_STEP_BPS)) problems.push("liquidity must be thin, moderate or deep");
  if (input.maturity !== "launch" && input.maturity !== "established") problems.push("maturity must be launch or established");
  if (problems.length) return { ok: false, problems };

  const endingFeeBps = Math.max(dbc.MIN_FEE_BPS, STEADY_STATE_BPS[input.expectedVolatility] + THIN_LIQUIDITY_STEP_BPS[input.liquidity]);
  const launch = input.maturity === "launch";
  const mode: "linear" | "exponential" = launch ? "exponential" : "linear";
  const startingFeeBps = launch ? Math.min(dbc.MAX_FEE_BPS, endingFeeBps * 5) : endingFeeBps;
  const numberOfPeriod = launch ? 12 : 0;
  const totalDuration = launch ? 3600 : 0;
  const dynamicFeeEnabled = input.expectedVolatility !== "low";

  const baseFeeMode = mode === "exponential" ? dbc.BaseFeeMode.FeeSchedulerExponential : dbc.BaseFeeMode.FeeSchedulerLinear;
  let sdkBaseFee: dbc.BaseFee;
  try {
    sdkBaseFee = dbc.getFeeSchedulerParams(startingFeeBps, endingFeeBps, baseFeeMode, numberOfPeriod, totalDuration);
  } catch (error) {
    return { ok: false, problems: [`SDK getFeeSchedulerParams: ${(error as Error).message}`] };
  }

  return {
    ok: true,
    modeled: true,
    label: "MODELED",
    mode,
    startingFeeBps,
    endingFeeBps,
    numberOfPeriod,
    totalDuration,
    dynamicFeeEnabled,
    baseFeeParams: { baseFeeMode, feeSchedulerParam: { startingFeeBps, endingFeeBps, numberOfPeriod, totalDuration } },
    sdkBaseFee,
    rationale: {
      mode: launch
        ? "exponential decay drops the launch premium quickly, so most of the first hour trades near the steady-state fee"
        : "flat fee: an established market has no launch premium to decay (linear with zero periods is the SDK's flat form)",
      startingFeeBps: launch
        ? `5x the steady-state fee (capped at ${dbc.MAX_FEE_BPS} bps) to make first-minute sniping expensive`
        : "equal to the ending fee; no schedule",
      endingFeeBps: `steady state: ${STEADY_STATE_BPS[input.expectedVolatility]} bps for ${input.expectedVolatility} volatility + ${THIN_LIQUIDITY_STEP_BPS[input.liquidity]} bps for ${input.liquidity} liquidity, floored at the SDK minimum ${dbc.MIN_FEE_BPS} bps`,
      numberOfPeriod: launch ? "12 steps over the decay window (5-minute periods)" : "0: flat fee",
      totalDuration: launch ? "3600 seconds: the launch premium is gone after one hour (assumes Timestamp activation)" : "0: flat fee",
      dynamicFeeEnabled: dynamicFeeEnabled
        ? "on: the volatility-driven variable fee adds protection when price moves fast"
        : "off: low expected volatility; a variable fee would mostly add cost",
    },
  };
}
