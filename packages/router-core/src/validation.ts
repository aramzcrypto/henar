/**
 * Native-vs-SDK-vs-Jupiter comparison (Task 11).
 *
 * `compareQuotes` is pure: it takes the three outputs for one input and
 * produces a `ComparisonRecord` with raw-unit and bps differences and a
 * pass/fail against an explicit tolerance. The live harness
 * (`scripts/router/validate-native.ts`) produces the inputs; until it has run
 * against live pools every venue's status is LIVE_VALIDATION_PENDING.
 *
 * Tolerances are per calculator status: SDK_BACKED calculators must match
 * the SDK exactly (0 raw units — same math, same bytes); live-pending ones
 * are allowed the configured bps because state may be read a slot apart.
 */
import type { CalculatorStatus } from "./native-state";
import type { RawAmount, Venue } from "./types";

export type ComparisonSide = {
  amountOut: RawAmount | null;
  slot: number | null;
  /** Why the side produced nothing, when it did not. */
  error: string | null;
};

export type ComparisonRecord = {
  schema: "henar.router.validation.v1";
  recordedAt: string;
  representationId: string;
  venue: Venue;
  poolAddress: string;
  side: "buy" | "sell";
  amountIn: RawAmount;
  calculatorStatus: CalculatorStatus;
  native: ComparisonSide;
  sdk: ComparisonSide;
  jupiter: ComparisonSide | null;
  /** native − sdk in raw units (null when either side is missing). */
  nativeVsSdkRaw: string | null;
  nativeVsSdkBps: number | null;
  /** native − jupiter in bps of jupiter, when both exist. */
  nativeVsJupiterBps: number | null;
  pass: boolean;
  reason: string;
  toleranceBps: number;
  /** Always false until the harness ran against live pools. */
  live: boolean;
};

export type ComparisonTolerance = {
  /** SDK_BACKED: exact match required (0). */
  sdkBackedBps: number;
  /** LIVE_VALIDATION_PENDING calculators: allowed drift vs SDK. */
  livePendingBps: number;
};

export const DEFAULT_COMPARISON_TOLERANCE: ComparisonTolerance = { sdkBackedBps: 0, livePendingBps: 1 };

/** (a − b) / |b| in bps with two decimals of precision (no whole-bps truncation). */
function diffBps(a: bigint, b: bigint) {
  if (b === 0n) return null;
  return Number(((a - b) * 1_000_000n) / (b < 0n ? -b : b)) / 100;
}

/** Exact tolerance test in integers: |a − b| × 10000 ≤ tol × |b|. */
function withinBps(a: bigint, b: bigint, toleranceBps: number) {
  const diff = a > b ? a - b : b - a;
  return diff * 10_000n <= BigInt(toleranceBps) * (b < 0n ? -b : b);
}

export function compareQuotes(input: {
  representationId: string;
  venue: Venue;
  poolAddress: string;
  side: "buy" | "sell";
  amountIn: RawAmount;
  calculatorStatus: CalculatorStatus;
  native: ComparisonSide;
  sdk: ComparisonSide;
  jupiter?: ComparisonSide | null;
  tolerance?: ComparisonTolerance;
  live?: boolean;
  now?: number;
}): ComparisonRecord {
  const tol = input.tolerance ?? DEFAULT_COMPARISON_TOLERANCE;
  const toleranceBps = input.calculatorStatus === "SDK_BACKED" ? tol.sdkBackedBps : tol.livePendingBps;
  const n = input.native.amountOut === null ? null : BigInt(input.native.amountOut);
  const s = input.sdk.amountOut === null ? null : BigInt(input.sdk.amountOut);
  const j = input.jupiter?.amountOut == null ? null : BigInt(input.jupiter.amountOut);

  let pass = false;
  let reason: string;
  let nativeVsSdkRaw: string | null = null;
  let nativeVsSdkBps: number | null = null;
  if (n === null && s === null) {
    // Both refused: agreement on unavailability is a pass only if the reasons agree.
    pass = input.native.error !== null && input.native.error === input.sdk.error;
    reason = pass ? `both unavailable: ${input.native.error}` : `native: ${input.native.error ?? "none"}; sdk: ${input.sdk.error ?? "none"}`;
  } else if (n === null || s === null) {
    reason = n === null ? `native unavailable (${input.native.error}) while sdk quoted` : `sdk unavailable (${input.sdk.error}) while native quoted`;
  } else {
    nativeVsSdkRaw = (n - s).toString();
    nativeVsSdkBps = diffBps(n, s);
    const slotsAgree = input.native.slot === null || input.sdk.slot === null || input.native.slot === input.sdk.slot;
    pass = withinBps(n, s, toleranceBps) && slotsAgree;
    reason = pass
      ? `within ${toleranceBps} bps (${nativeVsSdkRaw} raw)`
      : !slotsAgree
        ? `state slots differ (native ${input.native.slot}, sdk ${input.sdk.slot})`
        : `differs by ${nativeVsSdkRaw} raw (${nativeVsSdkBps} bps) > ${toleranceBps} bps`;
  }
  const live = input.live ?? false;
  if (!live) reason = `LIVE_VALIDATION_PENDING (fixture run): ${reason}`;
  return {
    schema: "henar.router.validation.v1",
    recordedAt: new Date(input.now ?? Date.now()).toISOString(),
    representationId: input.representationId,
    venue: input.venue,
    poolAddress: input.poolAddress,
    side: input.side,
    amountIn: input.amountIn,
    calculatorStatus: input.calculatorStatus,
    native: input.native,
    sdk: input.sdk,
    jupiter: input.jupiter ?? null,
    nativeVsSdkRaw,
    nativeVsSdkBps,
    nativeVsJupiterBps: n !== null && j !== null ? diffBps(n, j) : null,
    pass,
    reason,
    toleranceBps,
    live,
  };
}

export function summarizeComparisons(records: ComparisonRecord[]) {
  const byVenue = new Map<Venue, { total: number; pass: number; live: number; worstBps: number | null }>();
  for (const r of records) {
    const e = byVenue.get(r.venue) ?? { total: 0, pass: 0, live: 0, worstBps: null };
    e.total += 1;
    if (r.pass) e.pass += 1;
    if (r.live) e.live += 1;
    if (r.nativeVsSdkBps !== null) e.worstBps = Math.max(e.worstBps ?? 0, Math.abs(r.nativeVsSdkBps));
    byVenue.set(r.venue, e);
  }
  return {
    total: records.length,
    pass: records.filter((r) => r.pass).length,
    liveRecords: records.filter((r) => r.live).length,
    /** True only when every record is live and passing — the Task 11 gate. */
    gatePassed: records.length > 0 && records.every((r) => r.live && r.pass),
    venues: [...byVenue.entries()].map(([venue, e]) => ({ venue, ...e })),
  };
}
