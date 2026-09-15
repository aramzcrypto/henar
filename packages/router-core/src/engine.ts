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
  const pools = poolsForRepresentation(input.representationId);
  const ctx: QuoteContext = {
    connection: options.connection ?? null,
    pools,
    now,
    deadlineMs,
  };

  const latencyMs: Partial<Record<Venue, number>> = {};
  const quotes = await Promise.all(
    options.adapters.map(async (adapter) => {
      const started = Date.now();
      const quote = await withDeadline(
        adapter.getQuote(venueRequest, { ...ctx, pools: pools.filter((p) => p.venue === adapter.venue) }),
        deadlineMs,
        () => unavailableQuote(adapter.venue, venueRequest, "VENUE_TIMEOUT", `no quote within ${deadlineMs}ms`, null, now),
      );
      latencyMs[adapter.venue] = Date.now() - started;
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

  return {
    ...base,
    best: ranked[0] ?? null,
    alternatives: ranked.slice(1),
    exclusions,
    slot,
    latencyMs,
  };
}
