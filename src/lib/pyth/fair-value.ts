/**
 * Pyth Fair Value Engine. Pure; safe on the client and inside the guard.
 *
 * Inputs: the underlying equity reference, the tokenized representation's
 * reference, Pyth's redemption-rate feed for that token where one exists,
 * and the Henar route price. Outputs are basis points from exact rational
 * arithmetic.
 *
 * Two boundaries are kept apart on purpose:
 *  - TOKEN BASIS (token vs underlying) needs a verified conversion between
 *    one token and one share. Only a Pyth-published redemption rate is
 *    accepted; without one the basis is COMPARABILITY_UNVERIFIED, not 1:1.
 *  - EXECUTION DEVIATION (Henar route vs token reference) needs no such
 *    assumption and is what protects an execution.
 *
 * Tokenized equities trade around the clock. When the underlying market is
 * closed its last print is carried forward and is not the execution
 * boundary; a fresh tokenized reference is.
 */
import { PYTH_DEVIATION, PYTH_QUALITY } from "./config";
import { divide, isPositive, multiply, parseDecimal, relativeBps } from "./decimal-math";
import type { Comparability, FairValueAssessment, FairValueStatus, PythGuardState, PythReference } from "./types";

export type FairValueInput = {
  representationId: string;
  underlying: PythReference | null;
  token: PythReference | null;
  redemptionRate: PythReference | null;
  executable: FairValueAssessment["executableRoutePrice"];
  now?: number;
};

const usable = (ref: PythReference | null) => ref !== null && ref.freshness !== "stale";

export function assessFairValue(input: FairValueInput): FairValueAssessment {
  const now = input.now ?? Date.now();
  const reasons: string[] = [];
  const { underlying, token, redemptionRate, executable } = input;
  const comparability: Comparability = redemptionRate ? "redemption-rate" : "unverified";

  const tokenR = parseDecimal(token?.price);
  const underlyingR = parseDecimal(underlying?.price);
  const rrR = parseDecimal(redemptionRate?.price);
  const execR = parseDecimal(executable?.price);

  let tokenVsUnderlyingBps: number | null = null;
  if (isPositive(tokenR) && isPositive(underlyingR) && comparability === "redemption-rate" && isPositive(rrR)) {
    // One token redeems for `rr` shares, so its fair value is underlying × rr.
    const fair = multiply(underlyingR, rrR);
    tokenVsUnderlyingBps = relativeBps(tokenR, fair);
  } else if (token && underlying && comparability === "unverified") {
    reasons.push("no verified token/share conversion; token basis not computed");
  }

  let routeVsTokenBps: number | null = null;
  if (isPositive(execR) && isPositive(tokenR) && usable(token)) {
    routeVsTokenBps = relativeBps(execR, tokenR);
  }

  let executionReference: FairValueAssessment["executionReference"] = null;
  if (usable(token)) executionReference = "tokenized";
  else if (underlying && underlying.freshness === "live" && underlying.marketSession === "regular") executionReference = "underlying";

  const reference = executionReference === "tokenized" ? token : executionReference === "underlying" ? underlying : (token ?? underlying);
  const confidenceBps = reference?.confidenceBps ?? null;
  const publisherCount = reference?.publisherCount ?? null;

  let status: FairValueStatus;
  if (!token && !underlying) {
    status = "REFERENCE_UNAVAILABLE";
    reasons.push("no Pyth reference for this representation");
  } else if (!usable(token) && !usable(underlying)) {
    status = "STALE";
    reasons.push("every Pyth reference is beyond the stale window");
  } else if (executionReference === null) {
    status = "STALE";
    reasons.push(token ? "tokenized reference is stale" : "underlying market is not in a regular session and no tokenized reference exists");
  } else if ((publisherCount !== null && publisherCount < PYTH_QUALITY.minPublisherCount) || (confidenceBps !== null && confidenceBps > PYTH_QUALITY.maxConfidenceBps)) {
    status = "LOW_DATA_QUALITY";
    if (publisherCount !== null && publisherCount < PYTH_QUALITY.minPublisherCount) reasons.push(`${publisherCount} publishers (minimum ${PYTH_QUALITY.minPublisherCount})`);
    if (confidenceBps !== null && confidenceBps > PYTH_QUALITY.maxConfidenceBps) reasons.push(`confidence ${confidenceBps} bps of price (limit ${PYTH_QUALITY.maxConfidenceBps})`);
  } else if (routeVsTokenBps !== null && Math.abs(routeVsTokenBps) > PYTH_DEVIATION.routeVsTokenRefuseBps) {
    status = "EXECUTION_DEVIATION";
    reasons.push(`route price ${routeVsTokenBps > 0 ? "above" : "below"} the tokenized reference by ${Math.abs(routeVsTokenBps)} bps`);
  } else if (routeVsTokenBps !== null && Math.abs(routeVsTokenBps) > PYTH_DEVIATION.routeVsTokenWarnBps) {
    status = "WARNING";
    reasons.push(`route price ${routeVsTokenBps > 0 ? "above" : "below"} the tokenized reference by ${Math.abs(routeVsTokenBps)} bps`);
  } else if (tokenVsUnderlyingBps !== null && Math.abs(tokenVsUnderlyingBps) > PYTH_DEVIATION.tokenVsUnderlyingWarnBps) {
    status = "WARNING";
    reasons.push(`token trades ${Math.abs(tokenVsUnderlyingBps)} bps ${tokenVsUnderlyingBps > 0 ? "above" : "below"} the underlying`);
  } else if (token && underlying && comparability === "unverified" && executable === null) {
    status = "COMPARABILITY_UNVERIFIED";
  } else {
    status = "OK";
  }
  if (underlying && underlying.marketSession && underlying.marketSession !== "regular")
    reasons.push(`underlying market ${underlying.marketSession}; last print carried forward`);

  return {
    status,
    representationId: input.representationId,
    underlyingReference: underlying,
    tokenReference: token,
    redemptionRate,
    executableRoutePrice: executable,
    tokenVsUnderlyingBps,
    routeVsTokenBps,
    executionReference,
    comparability,
    underlyingMarketSession: underlying?.marketSession ?? null,
    underlyingFreshness: underlying?.freshness ?? null,
    tokenFreshness: token?.freshness ?? null,
    confidenceBps,
    publisherCount,
    assessedAt: new Date(now).toISOString(),
    reasons,
  };
}

/** The guard-facing state of an assessment. Never PYTH_PASS without a reference. */
export function guardStateOf(assessment: FairValueAssessment | null): PythGuardState {
  if (!assessment) return "PYTH_REFERENCE_UNAVAILABLE";
  switch (assessment.status) {
    case "REFERENCE_UNAVAILABLE":
      return "PYTH_REFERENCE_UNAVAILABLE";
    case "STALE":
      return "PYTH_STALE";
    case "LOW_DATA_QUALITY":
      return "PYTH_LOW_DATA_QUALITY";
    case "EXECUTION_DEVIATION":
      return "PYTH_EXECUTION_DEVIATION";
    case "WARNING":
      return "PYTH_WARNING";
    case "COMPARABILITY_UNVERIFIED":
      return "PYTH_COMPARABILITY_UNVERIFIED";
    default:
      return assessment.executionReference ? "PYTH_PASS" : "PYTH_REFERENCE_UNAVAILABLE";
  }
}

/** Human labels used by Markets and Trade. */
export const FAIR_VALUE_LABELS: Record<FairValueStatus, string> = {
  OK: "Within reference",
  WARNING: "Deviation warning",
  STALE: "Stale reference",
  LOW_DATA_QUALITY: "Low data quality",
  EXECUTION_DEVIATION: "Execution deviation",
  COMPARABILITY_UNVERIFIED: "Comparability unverified",
  REFERENCE_UNAVAILABLE: "No Pyth reference",
};

export function formatBps(bps: number | null) {
  if (bps === null) return "—";
  const sign = bps > 0 ? "+" : "";
  return `${sign}${(bps / 100).toFixed(2)}%`;
}

/** Utility for consumers that hold a USDC/token pair and want the execution price. */
export function executablePriceFrom(usdc: string, token: string): string | null {
  const u = parseDecimal(usdc);
  const t = parseDecimal(token);
  if (!isPositive(u) || !isPositive(t)) return null;
  const r = divide(u, t);
  if (!r) return null;
  // 8 decimals is ample for a USD price and keeps the string short.
  const scale = 10n ** 8n;
  const whole = (r.num * scale) / r.den;
  const s = whole.toString().padStart(9, "0");
  return `${s.slice(0, -8)}.${s.slice(-8)}`.replace(/\.?0+$/, "") || "0";
}
