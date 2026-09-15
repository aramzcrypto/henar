/**
 * Split-route optimizer (Task 12). Pure.
 *
 * Input: one `VenueCurve` per candidate venue — a deterministic function
 * from input amount to output amount on that venue's current state (built
 * from the venue's pure calculator over decoded state, or from fixtures in
 * tests). Output: an allocation across at most `maxLegs` venues, or the
 * single best venue when splitting does not clear the improvement threshold
 * after the complexity penalty.
 *
 * Algorithm: incremental marginal allocation. The input is divided into
 * `granularity` chunks; each chunk goes to the venue whose output for
 * (already allocated + chunk) minus its current output is highest. Ties
 * resolve by venue order for determinism. All arithmetic is bigint; chunk
 * rounding puts the remainder on the last chunk so the sum is exact.
 *
 * Safety: curves that return null (cannot fill) are skipped for that chunk;
 * unavailable venues are excluded before allocation; a split is only
 * returned when it beats the best single venue by at least
 * `minImprovementBps` **after** subtracting `legPenaltyBps` per extra leg.
 */
import { toRaw, type RawAmount, type Venue } from "./types";

export type VenueCurve = {
  venue: Venue;
  poolAddress: string | null;
  /** Output for `amountIn`, or null when the venue cannot fill that amount. */
  outputFor(amountIn: bigint): bigint | null;
  /** False excludes the venue entirely (guard refusal, disabled, stale). */
  available: boolean;
  unavailableReason?: string | null;
};

export type SplitOptions = {
  /** Number of allocation chunks (e.g. 20 → 5% steps). */
  granularity: number;
  maxLegs: number;
  /** Split must beat the best single venue by at least this much net of penalty. */
  minImprovementBps: number;
  /** Complexity penalty per extra leg, in bps of output. */
  legPenaltyBps: number;
};

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = { granularity: 20, maxLegs: 2, minImprovementBps: 5, legPenaltyBps: 2 };

export type SplitLeg = { venue: Venue; poolAddress: string | null; amountIn: RawAmount; amountOut: RawAmount; percentBps: number };

export type SplitResult = {
  /** "single" when one venue is used; "split" when more than one. */
  kind: "single" | "split" | "none";
  legs: SplitLeg[];
  totalIn: RawAmount;
  totalOut: RawAmount;
  /** Best single-venue output, for the record. */
  bestSingleOut: RawAmount | null;
  bestSingleVenue: Venue | null;
  /** Split improvement over best single, in bps, before penalty. */
  improvementBps: number | null;
  /** What was subtracted for extra legs. */
  penaltyBps: number;
  reason: string;
  excluded: { venue: Venue; reason: string }[];
};

function chunks(total: bigint, granularity: number): bigint[] {
  const g = BigInt(Math.max(1, granularity));
  const base = total / g;
  const out: bigint[] = [];
  let allocated = 0n;
  for (let i = 0n; i < g; i += 1n) {
    const size = i === g - 1n ? total - allocated : base;
    if (size > 0n) out.push(size);
    allocated += size;
  }
  return out;
}

export function optimizeSplit(curves: VenueCurve[], amountIn: bigint, options: SplitOptions = DEFAULT_SPLIT_OPTIONS): SplitResult {
  const excluded = curves.filter((c) => !c.available).map((c) => ({ venue: c.venue, reason: c.unavailableReason ?? "unavailable" }));
  const usable = curves.filter((c) => c.available);
  const none = (reason: string): SplitResult => ({ kind: "none", legs: [], totalIn: toRaw(amountIn), totalOut: "0", bestSingleOut: null, bestSingleVenue: null, improvementBps: null, penaltyBps: 0, reason, excluded });
  if (amountIn <= 0n) return none("amount must be positive");
  if (!usable.length) return none("no available venues");

  // Best single venue.
  let bestSingle: { curve: VenueCurve; out: bigint } | null = null;
  for (const curve of usable) {
    const out = curve.outputFor(amountIn);
    if (out !== null && out > 0n && (!bestSingle || out > bestSingle.out)) bestSingle = { curve, out };
  }

  // Marginal allocation.
  const allocated = new Map<VenueCurve, bigint>();
  const currentOut = new Map<VenueCurve, bigint>();
  for (const c of usable) {
    allocated.set(c, 0n);
    currentOut.set(c, 0n);
  }
  for (const chunk of chunks(amountIn, options.granularity)) {
    let best: { curve: VenueCurve; gain: bigint; newOut: bigint } | null = null;
    for (const curve of usable) {
      const already = allocated.get(curve)!;
      const legsUsed = [...allocated.values()].filter((v) => v > 0n).length;
      if (already === 0n && legsUsed >= options.maxLegs) continue; // would open one leg too many
      const newOut = curve.outputFor(already + chunk);
      if (newOut === null) continue;
      const gain = newOut - currentOut.get(curve)!;
      if (!best || gain > best.gain) best = { curve, gain, newOut };
    }
    if (!best) {
      // No venue can absorb this chunk; the split cannot fill the order.
      return bestSingle
        ? single(bestSingle, amountIn, excluded, "marginal allocation could not place every chunk; best single venue used")
        : none("no venue can fill the amount");
    }
    allocated.set(best.curve, allocated.get(best.curve)! + chunk);
    currentOut.set(best.curve, best.newOut);
  }

  const legs = [...allocated.entries()].filter(([, v]) => v > 0n);
  const splitOut = legs.reduce((s, [c]) => s + currentOut.get(c)!, 0n);
  if (!bestSingle) {
    if (legs.length === 0 || splitOut <= 0n) return none("no venue can fill the amount");
    return finish(legs, currentOut, amountIn, splitOut, null, excluded, "no single venue can fill the amount; split required", options, 0);
  }
  if (legs.length <= 1) return single(bestSingle, amountIn, excluded, "one venue absorbs the whole order");

  const improvementBps = Number(((splitOut - bestSingle.out) * 10_000n) / bestSingle.out);
  const penaltyBps = options.legPenaltyBps * (legs.length - 1);
  if (improvementBps - penaltyBps < options.minImprovementBps)
    return single(bestSingle, amountIn, excluded, `split improves ${improvementBps} bps, below ${options.minImprovementBps} bps after ${penaltyBps} bps penalty`);
  return finish(legs, currentOut, amountIn, splitOut, bestSingle, excluded, `split improves ${improvementBps} bps net of ${penaltyBps} bps penalty`, options, penaltyBps, improvementBps);
}

function single(best: { curve: VenueCurve; out: bigint }, amountIn: bigint, excluded: SplitResult["excluded"], reason: string): SplitResult {
  return {
    kind: "single",
    legs: [{ venue: best.curve.venue, poolAddress: best.curve.poolAddress, amountIn: toRaw(amountIn), amountOut: toRaw(best.out), percentBps: 10_000 }],
    totalIn: toRaw(amountIn),
    totalOut: toRaw(best.out),
    bestSingleOut: toRaw(best.out),
    bestSingleVenue: best.curve.venue,
    improvementBps: 0,
    penaltyBps: 0,
    reason,
    excluded,
  };
}

function finish(
  legs: [VenueCurve, bigint][],
  currentOut: Map<VenueCurve, bigint>,
  amountIn: bigint,
  splitOut: bigint,
  bestSingle: { curve: VenueCurve; out: bigint } | null,
  excluded: SplitResult["excluded"],
  reason: string,
  options: SplitOptions,
  penaltyBps: number,
  improvementBps: number | null = null,
): SplitResult {
  void options;
  return {
    kind: "split",
    legs: legs
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].venue.localeCompare(b[0].venue)))
      .map(([c, v]) => ({ venue: c.venue, poolAddress: c.poolAddress, amountIn: toRaw(v), amountOut: toRaw(currentOut.get(c)!), percentBps: Number((v * 10_000n) / amountIn) })),
    totalIn: toRaw(amountIn),
    totalOut: toRaw(splitOut),
    bestSingleOut: bestSingle ? toRaw(bestSingle.out) : null,
    bestSingleVenue: bestSingle?.curve.venue ?? null,
    improvementBps,
    penaltyBps,
    reason,
    excluded,
  };
}

/** Build a curve from a constant-product pool (x·y=k) with a fee — fixture helper for tests and documentation. */
export function constantProductCurve(venue: Venue, poolAddress: string | null, reserveIn: bigint, reserveOut: bigint, feeBps: number, available = true, unavailableReason: string | null = null): VenueCurve {
  return {
    venue,
    poolAddress,
    available,
    unavailableReason,
    outputFor(amountIn) {
      if (amountIn <= 0n) return 0n;
      const inAfterFee = amountIn - (amountIn * BigInt(feeBps)) / 10_000n;
      // Fixture semantic: a pool cannot absorb more than its own input reserve.
      if (inAfterFee > reserveIn) return null;
      const out = (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
      return out >= reserveOut ? null : out;
    },
  };
}
