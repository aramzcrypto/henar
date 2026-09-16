/**
 * Multi-venue quote engine.
 *
 * Fans a request out to every registered adapter with one deadline, applies
 * the Henar fee the same way /api/market does today, and ranks by net output
 * to the user. Venues that cannot quote are recorded as exclusions with a
 * structured reason; they are never dropped silently.
 *
 * Fee placement mirrors `src/lib/trade-fee.ts` and the live market path:
 *   buy  (USDC → equity): fee taken from the USDC input, venue quotes the rest;
 *   sell (equity → USDC): venue quotes the full input, fee taken from output.
 * The ranking key is therefore what the user keeps after every fee.
 *
 * Ranking picks the best quote, not the best execution. Task 9's guard and
 * Task 12's route optimiser sit between this result and any transaction.
 */
import { MARKET_FEE_BPS } from "@/lib/trade-fee";
import { poolsForRepresentation } from "./pool-registry";
import { flagEnabled } from "./flags";
import { requestScopedConnection } from "./request-cache";
import { DEFAULT_SPLIT_OPTIONS, optimizeSplit, type SplitOptions } from "./split";
import { adapterForPool, composePath, type PathFloors } from "./path";
import { routerRepresentation } from "./representations";
import { benchmarkRecord, type TelemetrySink } from "./telemetry";
import {
  bpsOf,
  fromRaw,
  toRaw,
  USDC_MINT,
  unavailableQuote,
  type EngineResult,
  type FeeBreakdown,
  type QuoteContext,
  type RankedRoute,
  type VenueCurve,
  type VerifiedPool,
  type QuoteExclusion,
  type QuoteRequest,
  type RankedQuote,
  type UnavailableReason,
  type Venue,
  type VenueAdapter,
  type VenueQuote,
} from "./types";
import type { Connection } from "@solana/web3.js";

export const DEFAULT_VENUE_DEADLINE_MS = 6_000;

/**
 * The smallest split gain worth carrying an extra leg, in bps.
 *
 * Not a competitiveness threshold: a construction above this is passed up and
 * ranked against every quote, including venues this optimizer cannot split
 * across. The old 5 bps threshold was applied against the best single native
 * pool and discarded an AAPLx split that beat Jupiter by 5.95 bps.
 */
export const MIN_SPLIT_EMIT_BPS = 1;

export type EngineOptions = {
  adapters: VenueAdapter[];
  connection?: Connection | null;
  deadlineMs?: number;
  henarFeeBps?: number;
  /** Overrides the HENAR_ROUTER_QUOTES flag; tests pass true. */
  enabled?: boolean;
  now?: () => number;
  /** Task 8: every result is recorded here. Recording never affects the result. */
  telemetry?: TelemetrySink | null;
  telemetryTags?: Record<string, string>;
  /**
   * Overrides HENAR_SPLIT_ROUTING. When on, every enabled pool is quoted
   * (not only the deepest per venue) and the split optimizer may allocate
   * across pools/venues that expose a curve.
   */
  splitRouting?: boolean;
  /** Override the smallest split gain that may be emitted, in bps. */
  minSplitEmitBps?: number;
  splitOptions?: SplitOptions;
  /** Test hook: replaces the registry lookup for this call. */
  poolsOverride?: VerifiedPool[];
  /**
   * Overrides HENAR_PATH_ROUTING. When on, a two-leg path through a qualified
   * intermediate is built from the representation's routing-leg pools and
   * reported next to the split. Off only when split routing is off.
   */
  pathRouting?: boolean;
  /** The floors the path is sized on; the API passes the execution policy's. */
  pathFloors?: PathFloors;
  /** Test hook: replaces the registry lookup of INTERMEDIATE_ROUTE pools. */
  intermediatePoolsOverride?: VerifiedPool[];
};

export function routerQuotesEnabled() {
  return process.env.HENAR_ROUTER_QUOTES === "1" || process.env.HENAR_ROUTER_QUOTES === "true";
}

type Validated =
  | { ok: true; request: QuoteRequest }
  | { ok: false; reason: UnavailableReason; detail: string };

/**
 * The router supports exactly USDC ↔ one verified representation. Any other
 * pair is rejected here, before a venue is asked anything.
 */
export function validateQuoteRequest(request: QuoteRequest): Validated {
  const rep = routerRepresentation(request.representationId);
  if (!rep) return { ok: false, reason: "INVALID_REQUEST", detail: "unknown representation" };
  if (rep.status !== "ACTIVE")
    return { ok: false, reason: "REPRESENTATION_RESTRICTED", detail: `representation is ${rep.status}` };
  if (request.amountType !== "input")
    return { ok: false, reason: "NOT_IMPLEMENTED", detail: "exact-out quotes are not supported yet" };
  let amount: bigint;
  try {
    amount = fromRaw(request.amount);
  } catch (error) {
    return { ok: false, reason: "INVALID_REQUEST", detail: (error as Error).message };
  }
  if (amount <= 0n) return { ok: false, reason: "INVALID_REQUEST", detail: "amount must be positive" };
  const expectedIn = request.side === "buy" ? USDC_MINT : rep.mint;
  const expectedOut = request.side === "buy" ? rep.mint : USDC_MINT;
  if (request.inputMint !== expectedIn || request.outputMint !== expectedOut)
    return { ok: false, reason: "INVALID_REQUEST", detail: "mints do not match side and representation" };
  return { ok: true, request };
}

function withDeadline(promise: Promise<VenueQuote>, ms: number, fallback: () => VenueQuote) {
  return new Promise<VenueQuote>((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback());
      },
    );
  });
}

/**
 * Apply the Henar fee to a venue quote and compute what the user keeps.
 *
 * The fee is charged exactly once, on the side /api/market charges it:
 * input for buys, output for sells. `fees` records every intermediate
 * amount and the identities below are asserted so a mismatch (a venue
 * that quoted a different input than it was given, a fee applied twice)
 * throws instead of producing a number.
 */
export function rankQuote(
  quote: VenueQuote,
  request: QuoteRequest,
  henarFeeBps: number,
): RankedQuote {
  const userInput = fromRaw(request.amount);
  const grossVenueOutput = fromRaw(quote.expectedAmountOut);
  const venueInput = fromRaw(quote.amountIn);

  const henarInputFee = request.side === "buy" ? bpsOf(userInput, henarFeeBps) : 0n;
  const henarOutputFee = request.side === "sell" ? bpsOf(grossVenueOutput, henarFeeBps) : 0n;
  const netUserOutput = grossVenueOutput - henarOutputFee;

  if (venueInput + henarInputFee !== userInput)
    throw new Error(
      `fee accounting: venue input ${venueInput} + Henar fee ${henarInputFee} != user input ${userInput}`,
    );
  if (henarInputFee > 0n && henarOutputFee > 0n)
    throw new Error("fee accounting: Henar fee on both sides");
  if (netUserOutput < 0n) throw new Error("fee accounting: negative net output");

  const fees: FeeBreakdown = {
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    userInput: toRaw(userInput),
    henarInputFee: toRaw(henarInputFee),
    venueInput: toRaw(venueInput),
    grossVenueOutput: toRaw(grossVenueOutput),
    venueFee: quote.venueFeeAmount,
    // Venues take their fee on the input side (CLMM, DLMM default), so the
    // fee mint is the input mint unless the quote says otherwise later.
    venueFeeMint: quote.venueFeeAmount === null ? null : request.inputMint,
    henarOutputFee: toRaw(henarOutputFee),
    netUserOutput: toRaw(netUserOutput),
    henarFeeBps,
  };
  return {
    ...quote,
    fees,
    henarFeeBps,
    henarFeeAmount: request.side === "buy" ? fees.henarInputFee : fees.henarOutputFee,
    henarFeeMint: request.side === "buy" ? request.inputMint : request.outputMint,
    swapInput: fees.venueInput,
    netOutput: fees.netUserOutput,
  };
}

export function compareRanked(a: RankedQuote, b: RankedQuote) {
  const na = fromRaw(a.netOutput);
  const nb = fromRaw(b.netOutput);
  if (na !== nb) return na > nb ? -1 : 1;
  const ia = a.priceImpactBps ?? Number.MAX_SAFE_INTEGER;
  const ib = b.priceImpactBps ?? Number.MAX_SAFE_INTEGER;
  if (ia !== ib) return ia - ib;
  const ea = a.executionPath === "none" ? 1 : 0;
  const eb = b.executionPath === "none" ? 1 : 0;
  if (ea !== eb) return ea - eb;
  return a.venue.localeCompare(b.venue);
}

export async function quoteRepresentation(
  input: QuoteRequest,
  options: EngineOptions,
): Promise<EngineResult> {
  const result = await quoteRepresentationUnrecorded(input, options);
  if (options.telemetry) {
    try {
      await options.telemetry.record(benchmarkRecord(result, { tags: options.telemetryTags }));
    } catch {
      // Telemetry is observational; a sink failure must never fail a quote.
    }
  }
  return result;
}

async function quoteRepresentationUnrecorded(
  input: QuoteRequest,
  options: EngineOptions,
): Promise<EngineResult> {
  const now = options.now?.() ?? Date.now();
  const quotedAt = new Date(now).toISOString();
  const enabled = options.enabled ?? routerQuotesEnabled();
  const henarFeeBps = options.henarFeeBps ?? MARKET_FEE_BPS;
  const base: EngineResult = {
    enabled,
    request: input,
    best: null,
    alternatives: [],
    route: null,
    splitReason: null,
    path: null,
    pathReason: null,
    exclusions: [],
    quotedAt,
    slot: null,
    latencyMs: {},
  };

  if (!enabled)
    return {
      ...base,
      exclusions: options.adapters.map((a) => ({
        venue: a.venue,
        poolAddress: null,
        reason: "ROUTER_DISABLED",
        detail: "HENAR_ROUTER_QUOTES is off",
      })),
    };

  const validated = validateQuoteRequest(input);
  if (!validated.ok)
    return {
      ...base,
      exclusions: options.adapters.map((a) => ({
        venue: a.venue,
        poolAddress: null,
        reason: validated.reason,
        detail: validated.detail,
      })),
    };

  // Venues quote the amount that will actually be swapped.
  const requested = fromRaw(input.amount);
  const venueAmount = input.side === "buy" ? requested - bpsOf(requested, henarFeeBps) : requested;
  if (venueAmount <= 0n)
    return {
      ...base,
      exclusions: options.adapters.map((a) => ({
        venue: a.venue,
        poolAddress: null,
        reason: "INVALID_REQUEST",
        detail: "amount is consumed by the fee",
      })),
    };
  const venueRequest: QuoteRequest = { ...input, amount: toRaw(venueAmount) };

  const deadlineMs = options.deadlineMs ?? DEFAULT_VENUE_DEADLINE_MS;
  /* Only pools that trade the requested pair are offered to the adapters.
     Every adapter picks its deepest pool for the representation, which was
     safe while every registry pool was a USDC pair. Routing legs put a
     representation's SOL pool in the same list, and on several assets that is
     the deepest one: an adapter would pick it for a USDC request and lose the
     quote to a terms mismatch. A pool is offered for the pair it trades and
     no other. */
  const allPools = options.poolsOverride ?? poolsForRepresentation(input.representationId);
  const requestedPair = new Set([input.inputMint, input.outputMint]);
  const pools = allPools.filter((pool) => requestedPair.has(pool.baseMint) && requestedPair.has(pool.quoteMint));
  /* Every adapter and every curve fetch in this request reads through one
     memoizing view of the connection. Five pools each re-read the same two
     mint accounts and asked for their own slot, and the split optimizer then
     read all of it again through `curve()`; in production that left four of
     five native quotes timing out and the optimizer short of the two curves a
     split needs. Freshness is unchanged, since all of it already happened
     inside a single request. */
  const scoped = options.connection ? requestScopedConnection(options.connection) : null;
  scoped?.begin();
  const ctx: QuoteContext = {
    connection: scoped?.connection ?? options.connection ?? null,
    pools,
    now,
    deadlineMs,
  };

  const latencyMs: Partial<Record<Venue, number>> = {};
  // Split routing is on by default once the router quotes; HENAR_SPLIT_ROUTING=0 turns it off.
  const splitRouting = options.splitRouting ?? (process.env.HENAR_SPLIT_ROUTING === undefined ? true : flagEnabled("splitRouting"));
  // One call per venue by default (the adapter picks its deepest pool); with
  // split routing on, one call per enabled pool so every pool is compared.
  const calls = options.adapters.flatMap((adapter) => {
    const venuePools = pools.filter((p) => p.venue === adapter.venue);
    if (splitRouting && venuePools.length > 1) return venuePools.map((pool) => ({ adapter, pools: [pool] }));
    return [{ adapter, pools: venuePools }];
  });
  const quotes = await Promise.all(
    calls.map(async ({ adapter, pools: callPools }) => {
      const started = Date.now();
      const quote = await withDeadline(
        adapter.getQuote(venueRequest, { ...ctx, pools: callPools }),
        deadlineMs,
        () => unavailableQuote(adapter.venue, venueRequest, "VENUE_TIMEOUT", `no quote within ${deadlineMs}ms`, callPools[0]?.address ?? null, now),
      );
      latencyMs[adapter.venue] = Math.max(latencyMs[adapter.venue] ?? 0, Date.now() - started);
      return quote;
    }),
  );

  const ranked: RankedQuote[] = [];
  const exclusions: QuoteExclusion[] = [];
  for (const quote of quotes) {
    if (quote.unavailableReason) {
      exclusions.push({
        venue: quote.venue,
        poolAddress: quote.poolAddress,
        reason: quote.unavailableReason,
        detail: quote.unavailableDetail,
      });
      continue;
    }
    // A venue that quoted different terms than asked is not comparable.
    if (
      quote.inputMint !== venueRequest.inputMint ||
      quote.outputMint !== venueRequest.outputMint ||
      quote.amountIn !== venueRequest.amount
    ) {
      exclusions.push({
        venue: quote.venue,
        poolAddress: quote.poolAddress,
        reason: "QUOTE_TERMS_MISMATCH",
        detail: "venue quoted different terms than requested",
      });
      continue;
    }
    try {
      ranked.push(rankQuote(quote, input, henarFeeBps));
    } catch (error) {
      exclusions.push({
        venue: quote.venue,
        poolAddress: quote.poolAddress,
        reason: "INVALID_REQUEST",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  ranked.sort(compareRanked);

  const slot = ranked.reduce<number | null>(
    (acc, q) => (q.slot === null ? acc : acc === null ? q.slot : Math.max(acc, q.slot)),
    null,
  );

  let route: RankedRoute | null = null;
  let splitReason: string | null = splitRouting ? (ranked.length > 1 ? null : "only one venue quoted; nothing to split across") : "split routing is off";
  if (splitRouting && ranked.length > 1) {
    try {
      const outcome = await splitAcrossPools(input, venueRequest, options, ctx, ranked, henarFeeBps, deadlineMs);
      route = outcome.route;
      splitReason = outcome.reason;
    } catch (error) {
      splitReason = `split routing failed: ${(error as Error).message}`;
      exclusions.push({ venue: ranked[0].venue, poolAddress: null, reason: "SDK_ERROR", detail: `split routing failed: ${(error as Error).message}` });
    }
  }

  /* A two-leg path is built from the routing-leg pools the pair filter above
     set aside. It is reported whether or not it wins; the caller ranks it
     against every direct quote and the split. */
  let path: RankedRoute | null = null;
  let pathReason: string | null = null;
  const pathRouting = options.pathRouting ?? (splitRouting && process.env.HENAR_PATH_ROUTING !== "0" && process.env.HENAR_PATH_ROUTING !== "false");
  if (!pathRouting) pathReason = splitRouting ? "path routing is off" : "split routing is off";
  else {
    try {
      const outcome = await composePath(input, venueAmount, allPools, {
        adapters: options.adapters,
        ctx,
        deadlineMs,
        henarFeeBps,
        floors: options.pathFloors,
        splitOptions: options.splitOptions,
        intermediatePoolsOverride: options.intermediatePoolsOverride,
      });
      path = outcome.route;
      pathReason = outcome.reason;
      if (path && ranked[0]) {
        const direct = fromRaw(ranked[0].netOutput);
        path.improvementBps = direct > 0n ? Number(((fromRaw(path.netOutput) - direct) * 10_000n) / direct) : null;
      }
    } catch (error) {
      pathReason = `path routing failed: ${(error as Error).message}`;
    }
  }

  return {
    ...base,
    best: ranked[0] ?? null,
    alternatives: ranked.slice(1),
    route,
    splitReason,
    path,
    pathReason,
    exclusions,
    slot,
    latencyMs,
  };
}

/**
 * Task 12 wiring: build a curve per available quoted pool, run the marginal
 * allocator, and return a ranked multi-leg route only when it beats the best
 * single venue by the configured threshold. Each leg is a real VenueQuote
 * from the same state the curve was built on.
 */
async function splitAcrossPools(
  input: QuoteRequest,
  venueRequest: QuoteRequest,
  options: EngineOptions,
  ctx: QuoteContext,
  ranked: RankedQuote[],
  henarFeeBps: number,
  deadlineMs: number,
): Promise<{ route: RankedRoute | null; reason: string }> {
  const curves: VenueCurve[] = [];
  await Promise.all(
    ranked.map(async (q) => {
      const pool = q.poolAddress ? ctx.pools.find((p) => p.address === q.poolAddress) : null;
      // Same venue, and an adapter that declares this pool type: Raydium
      // CLMM and CPMM share a venue id but not a curve.
      const adapter = pool ? adapterForPool(options.adapters, pool) : null;
      if (!adapter?.curve || !pool) return;
      const curve = await new Promise<VenueCurve | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), deadlineMs);
        adapter.curve!(venueRequest, pool, ctx).then((c) => { clearTimeout(timer); resolve(c); }, () => { clearTimeout(timer); resolve(null); });
      });
      if (curve) curves.push(curve);
    }),
  );
  if (curves.length < 2)
    return { route: null, reason: `only ${curves.length} venue curve${curves.length === 1 ? "" : "s"} could be built; a split needs two` };
  const venueAmount = fromRaw(venueRequest.amount);
  const split = optimizeSplit(curves, venueAmount, options.splitOptions ?? DEFAULT_SPLIT_OPTIONS);
  if (split.kind !== "split") return { route: null, reason: split.reason };
  /* Economically meaningless splits are suppressed here, and only here. The
     optimizer reports every construction it finds; this is the smallest gain
     worth an extra leg at all. Anything above it is handed up so the caller
     can rank it against quotes the optimizer cannot split across — that
     comparison, not this one, decides whether the split is used. */
  if ((split.netImprovementBps ?? 0) < (options.minSplitEmitBps ?? MIN_SPLIT_EMIT_BPS))
    return { route: null, reason: `${split.reason}; below the ${options.minSplitEmitBps ?? MIN_SPLIT_EMIT_BPS} bp floor for an extra leg` };
  const legs: RankedQuote[] = [];
  const userInput = fromRaw(input.amount);
  const totalFeeIn = input.side === "buy" ? bpsOf(userInput, henarFeeBps) : 0n;
  let feeAllocated = 0n;
  for (const [i, leg] of split.legs.entries()) {
    const curve = curves.find((c) => c.venue === leg.venue && c.poolAddress === leg.poolAddress);
    if (!curve?.quoteFor) return { route: null, reason: `no re-quotable curve for ${leg.venue}` };
    const quote = curve.quoteFor(fromRaw(leg.amountIn));
    if (quote.unavailableReason || quote.amountIn !== leg.amountIn)
      return { route: null, reason: `leg ${leg.venue} could not be re-quoted at its allocation: ${quote.unavailableReason ?? "terms drifted"}` };
    // Apportion the input-side fee by leg share (last leg takes the remainder) so
    // per-leg identities hold and the sum equals the route fee exactly.
    const legFeeIn = input.side === "buy" ? (i === split.legs.length - 1 ? totalFeeIn - feeAllocated : (totalFeeIn * fromRaw(leg.amountIn)) / venueAmount) : 0n;
    feeAllocated += legFeeIn;
    const gross = fromRaw(quote.expectedAmountOut);
    const legFeeOut = input.side === "sell" ? bpsOf(gross, henarFeeBps) : 0n;
    legs.push({
      ...quote,
      fees: {
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        userInput: toRaw(fromRaw(leg.amountIn) + legFeeIn),
        henarInputFee: toRaw(legFeeIn),
        venueInput: leg.amountIn,
        grossVenueOutput: quote.expectedAmountOut,
        venueFee: quote.venueFeeAmount,
        venueFeeMint: quote.venueFeeAmount === null ? null : input.inputMint,
        henarOutputFee: toRaw(legFeeOut),
        netUserOutput: toRaw(gross - legFeeOut),
        henarFeeBps,
      },
      henarFeeBps,
      henarFeeAmount: toRaw(input.side === "buy" ? legFeeIn : legFeeOut),
      henarFeeMint: input.side === "buy" ? input.inputMint : input.outputMint,
      swapInput: leg.amountIn,
      netOutput: toRaw(gross - legFeeOut),
    });
  }
  const grossTotal = legs.reduce((s, l) => s + fromRaw(l.fees.grossVenueOutput), 0n);
  const feeOut = input.side === "sell" ? bpsOf(grossTotal, henarFeeBps) : 0n;
  const net = grossTotal - feeOut;
  /* The construction is kept even when another source beats it.
     This compared the split against ranked[0] — the best quote overall,
     aggregators included — and discarded anything that lost to it. That is
     the same mistake as the old 5 bps threshold, one layer down and against a
     third baseline: a split that improves Henar's own best pool is worth
     reporting at second or third place, and hiding it is what made the
     product look like a wrapper around whichever venue won. Whether it is
     *selected* is a separate decision, made by the caller against the best
     approved executable quote.

     The only bar here is that the construction beat the best single native
     pool, which the optimizer has already established, net of Henar's fee.
     The fee is proportional on both sides, so it cannot reorder them. */
  const bestNativeSingle = split.bestSingleOut ? fromRaw(split.bestSingleOut) : null;
  if (bestNativeSingle !== null && grossTotal <= bestNativeSingle)
    return { route: null, reason: `the split does not beat the best single native pool (${split.reason})` };
  return { route: {
    kind: "split",
    legs,
    fees: {
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      userInput: toRaw(userInput),
      henarInputFee: toRaw(totalFeeIn),
      venueInput: venueRequest.amount,
      grossVenueOutput: toRaw(grossTotal),
      venueFee: null,
      venueFeeMint: null,
      henarOutputFee: toRaw(feeOut),
      netUserOutput: toRaw(net),
      henarFeeBps,
    },
    netOutput: toRaw(net),
    improvementBps: split.improvementBps,
    costBps: split.costBps,
    reason: split.reason,
  }, reason: split.reason };
}
