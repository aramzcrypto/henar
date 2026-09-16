/**
 * Smart Accumulate ladder construction, and the range maths Range Yield
 * shares with it. Pure, exact where it matters, and free of protocol SDKs so
 * it can be tested without a chain.
 *
 * A ladder is a set of prices below a reference, each with an allocation of
 * quote asset. Meteora fills them as one-way limit orders: capital converts
 * into stock as price falls through a level and stays converted.
 */
import Decimal from "decimal.js";
import type { AccumulationLevel, RawAmount } from "./types";

const D = Decimal.clone({ precision: 40 });

export type LadderInput = {
  /** Quote per whole stock unit, as a decimal string. */
  reference: string;
  /** Where accumulation starts, below the reference, in basis points. */
  rangeStartBps: number;
  /** Where it is fully allocated, in basis points. */
  rangeEndBps: number;
  levels: number;
  distribution: "EVEN" | "DEEPER_DIP";
  /** Quote-asset base units to spread across the ladder. */
  capital: bigint;
};

/**
 * Weights per level.
 *
 * EVEN spreads capital equally. DEEPER_DIP puts progressively more at lower
 * prices, so a deeper fall buys proportionally more: weight grows linearly
 * with depth, which is monotone, easy to state and easy to check.
 */
export function levelWeights(levels: number, distribution: LadderInput["distribution"]): number[] {
  if (!Number.isInteger(levels) || levels <= 0) throw new Error("levels must be a positive integer");
  if (distribution === "EVEN") return Array.from({ length: levels }, () => 1);
  return Array.from({ length: levels }, (_, i) => i + 1);
}

/**
 * Split an exact integer across weights without losing or inventing a unit.
 * The remainder goes to the last level, so the parts always sum to the whole.
 */
export function splitByWeight(total: bigint, weights: number[]): bigint[] {
  if (total < 0n) throw new Error("total must not be negative");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("weights must sum to a positive number");
  const parts = weights.map((w) => (total * BigInt(w)) / BigInt(sum));
  const assigned = parts.reduce((a, b) => a + b, 0n);
  parts[parts.length - 1] += total - assigned;
  return parts;
}

/** Prices from `rangeStartBps` to `rangeEndBps` below the reference, evenly spaced. */
export function levelPrices(input: Pick<LadderInput, "reference" | "rangeStartBps" | "rangeEndBps" | "levels">): string[] {
  const reference = new D(input.reference);
  if (!reference.isFinite() || reference.lte(0)) throw new Error("reference must be a positive price");
  if (input.rangeEndBps <= input.rangeStartBps) throw new Error("rangeEndBps must be deeper than rangeStartBps");
  const start = reference.mul(new D(10_000 - input.rangeStartBps).div(10_000));
  const end = reference.mul(new D(10_000 - input.rangeEndBps).div(10_000));
  if (input.levels === 1) return [start.toDecimalPlaces(8).toString()];
  const step = start.minus(end).div(input.levels - 1);
  return Array.from({ length: input.levels }, (_, i) => start.minus(step.mul(i)).toDecimalPlaces(8).toString());
}

/** The full ladder: prices descending, allocations summing exactly to capital. */
export function buildLadder(input: LadderInput): AccumulationLevel[] {
  const prices = levelPrices(input);
  const allocations = splitByWeight(input.capital, levelWeights(input.levels, input.distribution));
  return prices.map((price, index) => ({
    index,
    price,
    allocated: allocations[index].toString(),
    binId: null,
    filledQuote: "0",
    filledBase: "0",
    status: "pending" as const,
  }));
}

/** What the ladder has done so far. Sums are exact; the average is derived. */
export function ladderProgress(levels: AccumulationLevel[]) {
  const allocated = levels.reduce((sum, l) => sum + BigInt(l.allocated), 0n);
  const filledQuote = levels.reduce((sum, l) => sum + BigInt(l.filledQuote), 0n);
  const filledBase = levels.reduce((sum, l) => sum + BigInt(l.filledBase), 0n);
  return {
    allocated,
    filledQuote,
    filledBase,
    remainingQuote: allocated - filledQuote,
    levelsFilled: levels.filter((l) => l.status === "filled").length,
    levelsPartial: levels.filter((l) => l.status === "partial").length,
    levelsRemaining: levels.filter((l) => l.status === "pending").length,
  };
}

// ---------------------------------------------------------------------------
// Meteora bin maths
// ---------------------------------------------------------------------------

/**
 * price_per_lamport = ui_price × 10^(quoteDecimals − baseDecimals)
 *
 * Meteora's bin helpers work in price per lamport, and the SDK's
 * `getBinIdFromPrice` does not convert for you. Every UI price passes through
 * here first.
 */
export function toPricePerLamport(uiPrice: string, baseDecimals: number, quoteDecimals: number): string {
  return new D(uiPrice).mul(new D(10).pow(quoteDecimals - baseDecimals)).toString();
}

export function fromPricePerLamport(pricePerLamport: string, baseDecimals: number, quoteDecimals: number): string {
  return new D(pricePerLamport).div(new D(10).pow(quoteDecimals - baseDecimals)).toString();
}

/** binId = log(pricePerLamport) / log(1 + binStep/10000). */
export function binIdFromPricePerLamport(pricePerLamport: string, binStep: number, mode: "floor" | "ceil" = "floor") {
  const price = new D(pricePerLamport);
  if (!price.isFinite() || price.lte(0)) throw new Error("price per lamport must be positive");
  const base = new D(1).plus(new D(binStep).div(10_000));
  const id = price.ln().div(base.ln());
  return mode === "floor" ? Math.floor(id.toNumber()) : Math.ceil(id.toNumber());
}

/** price_per_lamport = (1 + binStep/10000)^binId. */
export function pricePerLamportFromBinId(binId: number, binStep: number): string {
  return new D(1).plus(new D(binStep).div(10_000)).pow(binId).toString();
}

/** A UI price straight to its bin, doing the lamport conversion on the way. */
export function binIdFromUiPrice(uiPrice: string, binStep: number, baseDecimals: number, quoteDecimals: number, mode: "floor" | "ceil" = "floor") {
  return binIdFromPricePerLamport(toPricePerLamport(uiPrice, baseDecimals, quoteDecimals), binStep, mode);
}

export function uiPriceFromBinId(binId: number, binStep: number, baseDecimals: number, quoteDecimals: number): string {
  return new D(fromPricePerLamport(pricePerLamportFromBinId(binId, binStep), baseDecimals, quoteDecimals)).toDecimalPlaces(8).toString();
}

/**
 * Map ladder levels onto bins. Several levels can land in one bin when the
 * bin step is coarse relative to the spacing; they are merged so the order
 * carries one amount per bin, which is what the protocol accepts.
 */
export function ladderToBins(levels: AccumulationLevel[], binStep: number, baseDecimals: number, quoteDecimals: number) {
  const byBin = new Map<number, bigint>();
  const assigned = levels.map((level) => {
    const binId = binIdFromUiPrice(level.price, binStep, baseDecimals, quoteDecimals, "floor");
    byBin.set(binId, (byBin.get(binId) ?? 0n) + BigInt(level.allocated));
    return { ...level, binId };
  });
  const bins = [...byBin.entries()].sort((a, b) => b[0] - a[0]).map(([binId, amount]) => ({ binId, amount: amount.toString() }));
  return { levels: assigned, bins };
}

// ---------------------------------------------------------------------------
// Range Yield
// ---------------------------------------------------------------------------

export type RangeInput = { reference: string; lowerBps: number; upperBps: number };

/** A price band around a reference, as UI prices. */
export function priceRange(input: RangeInput) {
  const reference = new D(input.reference);
  if (!reference.isFinite() || reference.lte(0)) throw new Error("reference must be a positive price");
  return {
    lower: reference.mul(new D(10_000 - input.lowerBps).div(10_000)).toDecimalPlaces(8).toString(),
    upper: reference.mul(new D(10_000 + input.upperBps).div(10_000)).toDecimalPlaces(8).toString(),
  };
}

export function inRange(current: string | null, lower: string, upper: string): boolean | null {
  if (current === null) return null;
  const price = new D(current);
  if (!price.isFinite()) return null;
  return price.gte(new D(lower)) && price.lte(new D(upper));
}

/**
 * Share of a position's value held in the stock, 0..1.
 *
 * Concentrated liquidity becomes stock-heavy as price falls and quote-heavy
 * as it rises, so this number is what makes the position's behaviour legible.
 */
export function baseShare(base: bigint, quote: bigint, price: string, baseDecimals: number, quoteDecimals: number): number | null {
  if (base < 0n || quote < 0n) return null;
  const p = new D(price);
  if (!p.isFinite() || p.lte(0)) return null;
  const baseValue = new D(base.toString()).div(new D(10).pow(baseDecimals)).mul(p);
  const quoteValue = new D(quote.toString()).div(new D(10).pow(quoteDecimals));
  const total = baseValue.plus(quoteValue);
  if (total.lte(0)) return null;
  return baseValue.div(total).toNumber();
}

/** Position value in quote base units, from its two sides and a price. */
export function positionValueQuote(base: bigint, quote: bigint, price: string, baseDecimals: number, quoteDecimals: number): RawAmount | null {
  const p = new D(price);
  if (!p.isFinite() || p.lte(0)) return null;
  const baseInQuote = new D(base.toString()).div(new D(10).pow(baseDecimals)).mul(p).mul(new D(10).pow(quoteDecimals));
  return baseInQuote.plus(new D(quote.toString())).toDecimalPlaces(0, Decimal.ROUND_DOWN).toString();
}

/**
 * Fee APR from observed fees over an observed window.
 *
 * Returns null below the minimum window: a few hours of fees annualized is
 * not a rate, it is a guess with a percent sign. Callers show "insufficient
 * history" rather than a number.
 */
export function feeApr(input: { feesQuote: bigint; positionValueQuote: bigint; windowHours: number; minimumWindowHours: number }): number | null {
  const { feesQuote, positionValueQuote: value, windowHours, minimumWindowHours } = input;
  if (windowHours < minimumWindowHours || value <= 0n || feesQuote < 0n) return null;
  const periodsPerYear = new D(8_760).div(windowHours);
  return new D(feesQuote.toString()).div(new D(value.toString())).mul(periodsPerYear).mul(100).toNumber();
}
