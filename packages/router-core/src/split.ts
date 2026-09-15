/**
 * Split-route optimizer (Task 12). Pure.
 *
 * Input: one `VenueCurve` per candidate venue — a deterministic function
 * from input amount to output amount on that venue's current state (built
 * from the venue's pure calculator over decoded state, or from fixtures in
 * tests). Output: the best construction it can find across at most `maxLegs`
 * venues, together with what that construction is worth.
 *
 * This decides nothing about whether the split should be used. It used to
 * collapse a split back to the single best venue whenever the gain fell under
 * a threshold, which threw away the very number the caller needs: an AAPLx
 * split that beat Jupiter by 5.95 bps was discarded because it improved the
 * best single *native* pool by only 2 bps, a comparison against the wrong
 * baseline. The construction and its raw improvement are returned; emission
 * policy belongs to the caller, which can see every quote.
 *
 * Algorithm, two phases:
 *  1. Coarse marginal allocation. The input is divided into `granularity`
 *     chunks; each chunk goes to the venue whose marginal output is highest.
 *     This chooses which venues to use and a rough share.
 *  2. Refinement of the boundary between the two chosen legs by ternary
 *     search on the allocation, which finds a far better split than raising
 *     the chunk count would: resolution becomes the search depth rather than
 *     1/granularity, at a few dozen pure evaluations over already-cached
 *     state. AMM output is concave in size, so the search is sound; where
 *     concentrated liquidity makes a curve piecewise, the refined result is
 *     accepted only when it actually beats the coarse one.
 *
 * Costs: there is no fixed per-leg tax. An extra leg costs real network fees,
 * not a made-up fraction of output, so `extraLegCostBps` defaults to zero and
 * is supplied by a caller that can estimate the incremental cost. Reliability
 * and freshness are not priced in here either; they are the guard's job, and
 * every leg is guarded on its own.
 */
import { toRaw, type RawAmount, type Venue, type VenueCurve } from "./types";

export type { VenueCurve };

export type SplitOptions = {
  /** Chunks used by the coarse phase (e.g. 20 → 5% steps) before refinement. */
  granularity: number;
  maxLegs: number;
  /**
   * Estimated incremental network cost of each extra leg, in bps of output.
   *
   * Zero by default: an extra leg costs transaction fees and compute, which a
   * caller that knows the fee market can estimate, and inventing a fixed tax
   * in output terms suppressed routes that were genuinely better for the
   * user. Reliability and freshness are handled by the guard, not priced here.
   */
  extraLegCostBps?: number;
  /** Refinement steps for the leg boundary. Resolution, not chunk count. */
  refineSteps?: number;
};

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = { granularity: 20, maxLegs: 2, extraLegCostBps: 0, refineSteps: 60 };

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
  /** Split improvement over the best single venue, in bps, before costs. */
  improvementBps: number | null;
  /** Estimated incremental network cost of the extra legs, in bps. */
  costBps: number;
  /** Improvement net of that cost: what the split is actually worth. */
  netImprovementBps: number | null;
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
  const none = (reason: string): SplitResult => ({ kind: "none", legs: [], totalIn: toRaw(amountIn), totalOut: "0", bestSingleOut: null, bestSingleVenue: null, improvementBps: null, costBps: 0, netImprovementBps: null, reason, excluded });
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

  let legs = [...allocated.entries()].filter(([, v]) => v > 0n);
  let splitOut = legs.reduce((s, [c]) => s + currentOut.get(c)!, 0n);

  /* Refine the boundary between two legs. The coarse phase resolves to
     1/granularity of the order; the search resolves to the order itself, for
     a few dozen evaluations of curves already built from cached state. The
     refined allocation is adopted only when it genuinely produces more. */
  let refined = false;
  if (legs.length === 2) {
    const [first, second] = legs.map(([curve]) => curve);
    const best = refineBoundary(first, second, amountIn, options.refineSteps ?? 60);
    if (best && best.total > splitOut) {
      currentOut.set(first, best.outA);
      currentOut.set(second, best.outB);
      allocated.set(first, best.amountA);
      allocated.set(second, amountIn - best.amountA);
      legs = [
        [first, best.amountA],
        [second, amountIn - best.amountA],
      ];
      splitOut = best.total;
      refined = true;
    }
  }

  if (!bestSingle) {
    if (legs.length === 0 || splitOut <= 0n) return none("no venue can fill the amount");
    return finish(legs, currentOut, amountIn, splitOut, null, excluded, "no single venue can fill the amount; split required", 0, null);
  }
  if (legs.length <= 1) return single(bestSingle, amountIn, excluded, "one venue absorbs the whole order");

  /* Every construction is returned with what it is worth. Nothing is
     discarded here for being small: the caller compares against every quote
     it has, including venues this optimizer cannot split across, and only it
     can tell a 2 bps gain that wins the whole comparison from one that does
     not. */
  const improvementBps = Number(((splitOut - bestSingle.out) * 100_000n) / bestSingle.out) / 10;
  const costBps = (options.extraLegCostBps ?? 0) * (legs.length - 1);
  const netImprovementBps = improvementBps - costBps;
  if (splitOut <= bestSingle.out)
    return single(bestSingle, amountIn, excluded, `split produced ${improvementBps} bps; the single venue is at least as good`);
  return finish(
    legs,
    currentOut,
    amountIn,
    splitOut,
    bestSingle,
    excluded,
    `split improves ${improvementBps} bps over the best single venue${costBps ? `, ${netImprovementBps} bps net of ${costBps} bps of extra-leg cost` : ""}${refined ? " (boundary refined)" : ""}`,
    costBps,
    improvementBps,
  );
}

/**
 * The allocation between two legs that maximises total output.
 *
 * Ternary search over the amount given to the first leg. AMM output is
 * concave in size, so the sum of two curves is concave and the search is
 * sound; where concentrated liquidity makes a curve piecewise the result is
 * still a valid construction, and the caller adopts it only when it beats the
 * coarse allocation. An allocation a curve cannot fill scores as unusable
 * rather than as zero, so the search walks away from it.
 */
type Allocation = { amountA: bigint; outA: bigint; outB: bigint; total: bigint };

function refineBoundary(a: VenueCurve, b: VenueCurve, total: bigint, steps: number): Allocation | null {
  const evaluate = (amountA: bigint): Allocation | null => {
    if (amountA < 0n || amountA > total) return null;
    const outA = amountA === 0n ? 0n : a.outputFor(amountA);
    const outB = total - amountA === 0n ? 0n : b.outputFor(total - amountA);
    if (outA === null || outB === null) return null;
    return { amountA, outA, outB, total: outA + outB };
  };
  let lo = 0n;
  let hi = total;
  let best: Allocation | null = null;
  const consider = (candidate: Allocation | null) => {
    if (candidate && (!best || candidate.total > best.total)) best = candidate;
  };
  for (let i = 0; i < steps && hi - lo > 1n; i += 1) {
    const third = (hi - lo) / 3n;
    const m1 = lo + (third > 0n ? third : 1n);
    const m2 = hi - (third > 0n ? third : 1n);
    const f1 = evaluate(m1);
    const f2 = evaluate(m2);
    consider(f1);
    consider(f2);
    if (f1 === null && f2 === null) break;
    // An unusable side is walked away from; otherwise keep the better half.
    if (f1 === null) lo = m1;
    else if (f2 === null) hi = m2;
    else if (f1.total < f2.total) lo = m1;
    else hi = m2;
  }
  consider(evaluate(lo));
  consider(evaluate(hi));
  return best;
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
    costBps: 0,
    netImprovementBps: 0,
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
  costBps: number,
  improvementBps: number | null,
): SplitResult {
  return {
    kind: "split",
    /* Shares are truncated per leg and would sum to 9,999 on an arbitrary
       boundary, so the last leg carries the remainder — the same rule the
       amounts themselves follow. A displayed allocation that does not add up
       to 100% is a bug report from a user. */
    legs: (() => {
      const ordered = [...legs].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].venue.localeCompare(b[0].venue)));
      let assigned = 0;
      return ordered.map(([c, v], index) => {
        const share = index === ordered.length - 1 ? 10_000 - assigned : Number((v * 10_000n) / amountIn);
        assigned += share;
        return { venue: c.venue, poolAddress: c.poolAddress, amountIn: toRaw(v), amountOut: toRaw(currentOut.get(c)!), percentBps: share };
      });
    })(),
    totalIn: toRaw(amountIn),
    totalOut: toRaw(splitOut),
    bestSingleOut: bestSingle ? toRaw(bestSingle.out) : null,
    bestSingleVenue: bestSingle?.curve.venue ?? null,
    improvementBps,
    costBps,
    netImprovementBps: improvementBps === null ? null : improvementBps - costBps,
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
