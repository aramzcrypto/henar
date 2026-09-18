/**
 * Two-leg paths through a qualified intermediate.
 *
 *   buy   USDC → intermediate → representation
 *   sell  representation → intermediate → USDC
 *
 * A representation's SOL or USDT pool is often deeper than its USDC pool, and
 * the intermediate's own USDC market is the deepest on the chain. This module
 * builds the best such path from the registry's ROUTING_LEG pools (the
 * representation side) and INTERMEDIATE_ROUTE pools (the USDC side), and
 * ranks it like any other route. Whether it is used is decided by the caller
 * against every direct quote.
 *
 * Sizing is the one thing that makes a path different from a split. The two
 * swaps run in one transaction as exact-in instructions, and the second one
 * cannot read what the first actually returned. Its input is therefore fixed
 * at the first hop's *floor* (expected output less that hop's slippage), so
 * the transaction lands whenever the first hop lands. Anything the first hop
 * returns above its floor stays in the user's wallet as intermediate; it is
 * reported as `residual` and never counted in the route's output. The floors
 * used here must be the floors the guard will set, so the caller passes the
 * policy's numbers in; the API then checks the guard agreed before the path
 * can be selected.
 */
import { intermediateRecord } from "./intermediates";
import { intermediateRoutePools } from "./pool-registry";
import { routerRepresentation } from "./representations";
import { optimizeSplit, routerSplitOptions, type SplitOptions } from "./split";
import {
  bpsOf,
  fromRaw,
  toRaw,
  USDC_MINT,
  executableAsNativeLeg,
  type FeeBreakdown,
  type QuoteContext,
  type QuoteRequest,
  type RankedQuote,
  type RankedRoute,
  type VenueAdapter,
  type VenueCurve,
  type VenueQuote,
  type VerifiedPool,
} from "./types";

export type PathFloors = {
  /** Fixed slippage of the USDC ↔ intermediate hop, in bps. */
  intermediateHopBps: number;
  /** Slippage of a representation-side leg for its price impact; null refuses the leg. */
  representationHopBps: (priceImpactBps: number | null) => number | null;
};

/** Mirrors DEFAULT_EXECUTION_POLICY; the API passes the live policy instead. */
export const DEFAULT_PATH_FLOORS: PathFloors = {
  intermediateHopBps: 10,
  representationHopBps: (impact) => {
    const required = Math.ceil(30 + Math.max(0, impact ?? 0) * 0.5);
    return required <= 100 ? required : null;
  },
};

export type PathOptions = {
  adapters: VenueAdapter[];
  ctx: QuoteContext;
  deadlineMs: number;
  henarFeeBps: number;
  floors?: PathFloors;
  splitOptions?: SplitOptions;
  /** Test hook: replaces the registry lookup of INTERMEDIATE_ROUTE pools. */
  intermediatePoolsOverride?: VerifiedPool[];
};

/** The adapter that quotes this pool: same venue, and a pool type it declares. */
export function adapterForPool(adapters: VenueAdapter[], pool: VerifiedPool) {
  return (
    adapters.find((a) => a.venue === pool.venue && a.capabilities().poolTypes.includes(pool.poolType)) ??
    adapters.find((a) => a.venue === pool.venue) ??
    null
  );
}

async function curvesFor(request: QuoteRequest, pools: VerifiedPool[], options: PathOptions): Promise<VenueCurve[]> {
  const curves: VenueCurve[] = [];
  await Promise.all(
    pools.map(async (pool) => {
      const adapter = adapterForPool(options.adapters, pool);
      if (!adapter?.curve) return;
      /* Both hops of a path are built by Henar, so both must come from venues
         that can build. A quote-only venue here would produce a path that
         prices well and cannot be executed. */
      if (!executableAsNativeLeg(adapter.capabilities())) return;
      const curve = await new Promise<VenueCurve | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), options.deadlineMs);
        adapter.curve!(request, pool, { ...options.ctx, pools: [pool] }).then(
          (c) => { clearTimeout(timer); resolve(c); },
          () => { clearTimeout(timer); resolve(null); },
        );
      });
      if (curve?.available && curve.quoteFor) curves.push(curve);
    }),
  );
  return curves;
}

function bestSingle(curves: VenueCurve[], amountIn: bigint) {
  let best: { curve: VenueCurve; out: bigint } | null = null;
  for (const curve of curves) {
    const out = curve.outputFor(amountIn);
    if (out !== null && out > 0n && (!best || out > best.out)) best = { curve, out };
  }
  return best;
}

/** Allocate across the representation-side pools: a split when it pays, else the best single. */
function allocate(curves: VenueCurve[], amountIn: bigint, options: PathOptions): { curve: VenueCurve; amountIn: bigint }[] | null {
  if (curves.length > 1) {
    const split = optimizeSplit(curves, amountIn, options.splitOptions ?? routerSplitOptions());
    if (split.kind === "split" && (split.netImprovementBps ?? 0) >= 1) {
      const legs = split.legs.map((leg) => ({ curve: curves.find((c) => c.venue === leg.venue && c.poolAddress === leg.poolAddress)!, amountIn: fromRaw(leg.amountIn) }));
      if (legs.every((l) => l.curve)) return legs;
    }
  }
  const single = bestSingle(curves, amountIn);
  return single ? [{ curve: single.curve, amountIn }] : null;
}

function leg(
  quote: VenueQuote,
  fee: { henarFeeBps: number; inputFee: bigint; outputFee: bigint; feeMint: string },
): RankedQuote {
  const venueInput = fromRaw(quote.amountIn);
  const gross = fromRaw(quote.expectedAmountOut);
  const fees: FeeBreakdown = {
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    userInput: toRaw(venueInput + fee.inputFee),
    henarInputFee: toRaw(fee.inputFee),
    venueInput: toRaw(venueInput),
    grossVenueOutput: toRaw(gross),
    venueFee: quote.venueFeeAmount,
    venueFeeMint: quote.venueFeeAmount === null ? null : quote.inputMint,
    henarOutputFee: toRaw(fee.outputFee),
    netUserOutput: toRaw(gross - fee.outputFee),
    henarFeeBps: fee.henarFeeBps,
  };
  return {
    ...quote,
    fees,
    henarFeeBps: fee.henarFeeBps,
    henarFeeAmount: toRaw(fee.inputFee > 0n ? fee.inputFee : fee.outputFee),
    henarFeeMint: fee.feeMint,
    swapInput: fees.venueInput,
    netOutput: fees.netUserOutput,
  };
}

function usable(quote: VenueQuote, amountIn: bigint) {
  return quote.unavailableReason === null && fromRaw(quote.amountIn) === amountIn && fromRaw(quote.expectedAmountOut) > 0n;
}

type Built = { route: RankedRoute | null; reason: string };

async function buyPath(input: QuoteRequest, venueAmount: bigint, intermediate: string, legPools: VerifiedPool[], hopPools: VerifiedPool[], options: PathOptions): Promise<Built> {
  const floors = options.floors ?? DEFAULT_PATH_FLOORS;
  const fee = fromRaw(input.amount) - venueAmount;
  const requestA: QuoteRequest = { ...input, amount: toRaw(venueAmount), inputMint: USDC_MINT, outputMint: intermediate };
  const curvesA = await curvesFor(requestA, hopPools, options);
  const a = bestSingle(curvesA, venueAmount);
  if (!a) return { route: null, reason: "no USDC pool of the intermediate could fill the first hop" };
  const quoteA = a.curve.quoteFor!(venueAmount);
  if (!usable(quoteA, venueAmount)) return { route: null, reason: `first hop could not be re-quoted: ${quoteA.unavailableReason ?? "terms drifted"}` };
  const aOut = fromRaw(quoteA.expectedAmountOut);
  const aFloor = aOut - bpsOf(aOut, floors.intermediateHopBps);
  if (aFloor <= 0n) return { route: null, reason: "first hop floor rounds to zero" };

  const requestB: QuoteRequest = { ...input, amount: toRaw(aFloor), inputMint: intermediate, outputMint: input.outputMint };
  const curvesB = await curvesFor(requestB, legPools, options);
  const allocation = allocate(curvesB, aFloor, options);
  if (!allocation) return { route: null, reason: "no routing-leg pool could fill the second hop" };
  const legsB: RankedQuote[] = [];
  for (const { curve, amountIn } of allocation) {
    const quote = curve.quoteFor!(amountIn);
    if (!usable(quote, amountIn)) return { route: null, reason: `second hop leg ${curve.venue} could not be re-quoted: ${quote.unavailableReason ?? "terms drifted"}` };
    if (floors.representationHopBps(quote.priceImpactBps) === null) return { route: null, reason: `second hop leg ${curve.venue} needs more slippage than policy allows` };
    legsB.push(leg(quote, { henarFeeBps: options.henarFeeBps, inputFee: 0n, outputFee: 0n, feeMint: USDC_MINT }));
  }
  const gross = legsB.reduce((s, l) => s + fromRaw(l.fees.grossVenueOutput), 0n);
  const legA = leg(quoteA, { henarFeeBps: options.henarFeeBps, inputFee: fee, outputFee: 0n, feeMint: USDC_MINT });
  return {
    route: {
      kind: "path",
      legs: [legA, ...legsB],
      intermediate: describe(intermediate),
      residual: { mint: intermediate, expected: toRaw(aOut - aFloor), floorBps: floors.intermediateHopBps },
      fees: {
        inputMint: USDC_MINT,
        outputMint: input.outputMint,
        userInput: input.amount,
        henarInputFee: toRaw(fee),
        venueInput: toRaw(venueAmount),
        grossVenueOutput: toRaw(gross),
        venueFee: null,
        venueFeeMint: null,
        henarOutputFee: "0",
        netUserOutput: toRaw(gross),
        henarFeeBps: options.henarFeeBps,
      },
      netOutput: toRaw(gross),
      improvementBps: null,
      costBps: 0,
      reason: `USDC → ${describe(intermediate)?.symbol ?? intermediate} → representation over ${legsB.length} leg${legsB.length === 1 ? "" : "s"}`,
    },
    reason: "path built",
  };
}

async function sellPath(input: QuoteRequest, venueAmount: bigint, intermediate: string, legPools: VerifiedPool[], hopPools: VerifiedPool[], options: PathOptions): Promise<Built> {
  const floors = options.floors ?? DEFAULT_PATH_FLOORS;
  const requestB: QuoteRequest = { ...input, amount: toRaw(venueAmount), inputMint: input.inputMint, outputMint: intermediate };
  const curvesB = await curvesFor(requestB, legPools, options);
  const allocation = allocate(curvesB, venueAmount, options);
  if (!allocation) return { route: null, reason: "no routing-leg pool could fill the first hop" };
  const legsB: RankedQuote[] = [];
  let bOut = 0n;
  let bFloor = 0n;
  for (const { curve, amountIn } of allocation) {
    const quote = curve.quoteFor!(amountIn);
    if (!usable(quote, amountIn)) return { route: null, reason: `first hop leg ${curve.venue} could not be re-quoted: ${quote.unavailableReason ?? "terms drifted"}` };
    const slip = floors.representationHopBps(quote.priceImpactBps);
    if (slip === null) return { route: null, reason: `first hop leg ${curve.venue} needs more slippage than policy allows` };
    const out = fromRaw(quote.expectedAmountOut);
    bOut += out;
    bFloor += out - bpsOf(out, slip);
    legsB.push(leg(quote, { henarFeeBps: options.henarFeeBps, inputFee: 0n, outputFee: 0n, feeMint: USDC_MINT }));
  }
  if (bFloor <= 0n) return { route: null, reason: "first hop floor rounds to zero" };
  const requestA: QuoteRequest = { ...input, amount: toRaw(bFloor), inputMint: intermediate, outputMint: USDC_MINT };
  const curvesA = await curvesFor(requestA, hopPools, options);
  const a = bestSingle(curvesA, bFloor);
  if (!a) return { route: null, reason: "no USDC pool of the intermediate could fill the second hop" };
  const quoteA = a.curve.quoteFor!(bFloor);
  if (!usable(quoteA, bFloor)) return { route: null, reason: `second hop could not be re-quoted: ${quoteA.unavailableReason ?? "terms drifted"}` };
  const gross = fromRaw(quoteA.expectedAmountOut);
  const feeOut = bpsOf(gross, options.henarFeeBps);
  const legA = leg(quoteA, { henarFeeBps: options.henarFeeBps, inputFee: 0n, outputFee: feeOut, feeMint: USDC_MINT });
  return {
    route: {
      kind: "path",
      legs: [...legsB, legA],
      intermediate: describe(intermediate),
      residual: { mint: intermediate, expected: toRaw(bOut - bFloor), floorBps: 0 },
      fees: {
        inputMint: input.inputMint,
        outputMint: USDC_MINT,
        userInput: input.amount,
        henarInputFee: "0",
        venueInput: toRaw(venueAmount),
        grossVenueOutput: toRaw(gross),
        venueFee: null,
        venueFeeMint: null,
        henarOutputFee: toRaw(feeOut),
        netUserOutput: toRaw(gross - feeOut),
        henarFeeBps: options.henarFeeBps,
      },
      netOutput: toRaw(gross - feeOut),
      improvementBps: null,
      costBps: 0,
      reason: `representation → ${describe(intermediate)?.symbol ?? intermediate} → USDC over ${legsB.length} leg${legsB.length === 1 ? "" : "s"}`,
    },
    reason: "path built",
  };
}

function describe(mint: string): RankedRoute["intermediate"] {
  const record = intermediateRecord(mint);
  return record ? { mint, symbol: record.symbol, decimals: record.decimals, tokenProgram: record.tokenProgram } : null;
}

/**
 * Build the best path for this request from the representation's enabled
 * ROUTING_LEG pools. Every intermediate with legs is tried; the one with the
 * best net output wins. `reason` explains a null route.
 */
export async function composePath(input: QuoteRequest, venueAmount: bigint, allPools: VerifiedPool[], options: PathOptions): Promise<Built> {
  const rep = routerRepresentation(input.representationId);
  if (!rep) return { route: null, reason: "unknown representation" };
  const legPools = allPools.filter((p) => p.enabled && p.eligibility === "ROUTING_LEG");
  if (!legPools.length) return { route: null, reason: "no routing-leg pools for this representation" };
  const byIntermediate = new Map<string, VerifiedPool[]>();
  for (const pool of legPools) {
    const other = pool.baseMint === rep.mint ? pool.quoteMint : pool.baseMint;
    byIntermediate.set(other, [...(byIntermediate.get(other) ?? []), pool]);
  }
  const reasons: string[] = [];
  let best: RankedRoute | null = null;
  for (const [intermediate, pools] of byIntermediate) {
    const label = intermediateRecord(intermediate)?.symbol ?? intermediate.slice(0, 6);
    if (!intermediateRecord(intermediate)?.qualified) { reasons.push(`${label}: not a qualified intermediate`); continue; }
    const hopPools = (options.intermediatePoolsOverride ?? intermediateRoutePools(intermediate)).filter((p) => p.mint === intermediate && p.enabled);
    if (!hopPools.length) { reasons.push(`${label}: no USDC pool for the intermediate in the registry`); continue; }
    try {
      const built = input.side === "buy"
        ? await buyPath(input, venueAmount, intermediate, pools, hopPools, options)
        : await sellPath(input, venueAmount, intermediate, pools, hopPools, options);
      if (!built.route) { reasons.push(`${label}: ${built.reason}`); continue; }
      if (!best || fromRaw(built.route.netOutput) > fromRaw(best.netOutput)) best = built.route;
    } catch (error) {
      reasons.push(`${label}: ${(error as Error).message}`);
    }
  }
  if (!best) return { route: null, reason: reasons.join("; ") || "no path could be built" };
  return { route: best, reason: best.reason };
}
