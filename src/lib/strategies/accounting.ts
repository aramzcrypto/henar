/**
 * Strategy accounting. Exact integer arithmetic on base units; no floats
 * touch a balance, a yield figure or a fee.
 *
 * The rule the whole module exists to enforce: principal is never converted,
 * and a performance fee is only ever assessed against realized yield.
 */
import type { RawAmount } from "./types";

export const raw = (value: bigint): RawAmount => value.toString();

export function toBig(value: RawAmount | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (!/^-?\d+$/.test(value)) throw new Error(`not a base-unit integer: ${value}`);
  return BigInt(value);
}

/** Basis points of an amount, rounded down. */
export function bpsOf(amount: bigint, bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`bps out of range: ${bps}`);
  return (amount * BigInt(bps)) / 10_000n;
}

/**
 * The basis Henar records when it supplies to a lending reserve.
 *
 * klend keeps no per-position cost basis, and the collateral balance does not
 * grow — the exchange rate moves instead. Recording the rate at deposit is
 * what makes realized yield computable later, and re-baselining on harvest is
 * what keeps it correct across more than one harvest.
 */
export type YieldBasis = {
  /** Collateral token base units credited by the protocol. */
  collateralAmount: RawAmount;
  /**
   * Exchange rate at deposit, as a decimal string. klend's rate is
   * collateral-per-liquidity and falls as interest accrues, so
   * liquidity = collateral / rate.
   */
  exchangeRateAtBasis: string;
  /** Liquidity base units the basis is worth, computed once at recording. */
  liquidityAtBasis: RawAmount;
  recordedAt: string;
};

/**
 * Realized yield available to harvest: what the position is worth now, less
 * the recorded basis. Never negative — a rate that has not moved yields zero,
 * and a rate that moved the wrong way is a zero, not a debt.
 */
export function accruedYield(currentLiquidity: bigint, basis: YieldBasis) {
  const delta = currentLiquidity - toBig(basis.liquidityAtBasis);
  return delta > 0n ? delta : 0n;
}

export type HarvestDecision =
  | { harvest: true; amount: bigint; reason: null }
  | { harvest: false; amount: bigint; reason: string };

/**
 * Whether accrued yield is worth converting yet. Converting dust burns more
 * in fees and transaction cost than it accumulates, so a strategy that has
 * earned fourteen cents says so rather than trading it.
 */
export function shouldHarvest(input: {
  accrued: bigint;
  minimumAmount: bigint;
  maximumAmount: bigint;
  lastHarvestAt: number | null;
  minimumIntervalMs: number;
  now: number;
}): HarvestDecision {
  const { accrued, minimumAmount, maximumAmount, lastHarvestAt, minimumIntervalMs, now } = input;
  if (accrued <= 0n) return { harvest: false, amount: 0n, reason: "no yield has accrued yet" };
  if (accrued < minimumAmount)
    return { harvest: false, amount: accrued, reason: `accrued yield is below the ${minimumAmount} minimum` };
  if (lastHarvestAt !== null && now - lastHarvestAt < minimumIntervalMs) {
    const hours = Math.ceil((minimumIntervalMs - (now - lastHarvestAt)) / 3_600_000);
    return { harvest: false, amount: accrued, reason: `next conversion is eligible in about ${hours}h` };
  }
  const amount = accrued > maximumAmount ? maximumAmount : accrued;
  return { harvest: true, amount, reason: null };
}

/** The ledger a cash-yield strategy keeps. Every field is base units. */
export type YieldLedger = {
  principalDeposited: bigint;
  yieldRealized: bigint;
  yieldPendingConversion: bigint;
  yieldConverted: bigint;
  stockAccumulated: bigint;
  strategyFees: bigint;
};

export function emptyYieldLedger(): YieldLedger {
  return { principalDeposited: 0n, yieldRealized: 0n, yieldPendingConversion: 0n, yieldConverted: 0n, stockAccumulated: 0n, strategyFees: 0n };
}

export function depositPrincipal(ledger: YieldLedger, amount: bigint): YieldLedger {
  if (amount <= 0n) throw new Error("deposit must be positive");
  return { ...ledger, principalDeposited: ledger.principalDeposited + amount };
}

/**
 * Yield withdrawn from the yield source and now held as the quote asset.
 *
 * The performance fee, when one is ever active, is taken here: from realized
 * yield, at the moment it is realized, and from nothing else.
 */
export function realizeYield(ledger: YieldLedger, amount: bigint, performanceFeeBps: number): YieldLedger {
  if (amount <= 0n) throw new Error("realized yield must be positive");
  const fee = bpsOf(amount, performanceFeeBps);
  return {
    ...ledger,
    yieldRealized: ledger.yieldRealized + amount,
    yieldPendingConversion: ledger.yieldPendingConversion + (amount - fee),
    strategyFees: ledger.strategyFees + fee,
  };
}

/** Realized yield spent on stock. Principal is untouched by construction. */
export function convertYield(ledger: YieldLedger, quoteSpent: bigint, stockReceived: bigint): YieldLedger {
  if (quoteSpent <= 0n) throw new Error("conversion amount must be positive");
  if (quoteSpent > ledger.yieldPendingConversion) throw new Error("conversion exceeds realized yield: principal is never converted");
  if (stockReceived <= 0n) throw new Error("conversion must receive stock");
  return {
    ...ledger,
    yieldPendingConversion: ledger.yieldPendingConversion - quoteSpent,
    yieldConverted: ledger.yieldConverted + quoteSpent,
    stockAccumulated: ledger.stockAccumulated + stockReceived,
  };
}

/** Realized yield after Henar's share. */
export function netYield(ledger: YieldLedger) {
  return ledger.yieldRealized - ledger.strategyFees;
}

/**
 * Average price paid, as a decimal string in quote units per whole stock
 * unit. Null before the first fill: an average of nothing is not zero.
 */
export function averagePrice(quoteSpent: bigint, baseReceived: bigint, quoteDecimals: number, baseDecimals: number, places = 6): string | null {
  if (quoteSpent <= 0n || baseReceived <= 0n) return null;
  // price = (quote / 10^qd) / (base / 10^bd) = quote × 10^(bd − qd) / base
  const scale = 10n ** BigInt(places);
  const numerator = quoteSpent * 10n ** BigInt(baseDecimals) * scale;
  const denominator = baseReceived * 10n ** BigInt(quoteDecimals);
  if (denominator === 0n) return null;
  const scaled = numerator / denominator;
  const text = scaled.toString().padStart(places + 1, "0");
  const point = text.length - places;
  return `${text.slice(0, point)}.${text.slice(point)}`.replace(/\.?0+$/, "") || "0";
}

/**
 * An accounting mismatch between Henar's ledger and what the protocol
 * reports. A strategy whose books disagree with the chain is paused rather
 * than acted on.
 */
export function accountingMismatch(input: { ledgerPrincipal: bigint; protocolPrincipal: bigint | null; toleranceBps: number }) {
  const { ledgerPrincipal, protocolPrincipal, toleranceBps } = input;
  if (protocolPrincipal === null) return null;
  if (ledgerPrincipal === 0n) return protocolPrincipal === 0n ? null : `protocol reports ${protocolPrincipal} against an empty ledger`;
  const diff = protocolPrincipal > ledgerPrincipal ? protocolPrincipal - ledgerPrincipal : ledgerPrincipal - protocolPrincipal;
  const tolerance = bpsOf(ledgerPrincipal, toleranceBps);
  return diff > tolerance ? `ledger principal ${ledgerPrincipal} differs from protocol ${protocolPrincipal} by more than ${toleranceBps} bps` : null;
}
