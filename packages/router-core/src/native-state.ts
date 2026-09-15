/**
 * Native state abstraction (Task 10).
 *
 * Henar owns state acquisition and normalization; it does not own every
 * mathematical primitive. A `NativeCalculator` is either:
 *
 *   SDK_BACKED               deterministic, pure SDK math over Henar-decoded
 *                            state — validated offline against the SDK's own
 *                            quote path (DBC, DAMM v2);
 *   LIVE_VALIDATION_PENDING  needs SDK-fetched state (tick arrays, bin
 *                            arrays) that this device cannot read; wired to
 *                            the SDK's compute path and compared live by the
 *                            Task 11 harness (Raydium CLMM, Meteora DLMM).
 *
 * Nothing here reimplements curve/tick/bin formulas.
 */
import type { AccountInfo } from "@solana/web3.js";
import type { MintInspection, PoolType, RawAmount, Venue } from "./types";

export type CalculatorStatus = "SDK_BACKED" | "LIVE_VALIDATION_PENDING";

/** Common envelope for any normalized pool state. */
export type StateEnvelope = {
  venue: Venue;
  poolType: PoolType;
  poolAddress: string;
  programId: string;
  /** Slot the state was read at; null for fixtures that carry no slot. */
  slot: number | null;
  readAt: string;
  /** How the state was obtained — RPC account read, stream update, or fixture. */
  source: "rpc" | "stream" | "fixture";
  baseMint: MintInspection | null;
  quoteMint: MintInspection | null;
};

export type NormalizedPoolState<T = unknown> = StateEnvelope & {
  /** Venue-specific decoded state, in the shape the venue SDK's pure math expects. */
  decoded: T;
};

export type NativeQuoteInput = {
  inputMint: string;
  outputMint: string;
  amountIn: bigint;
  /** Slot or timestamp, per venue activation semantics. */
  currentPoint: bigint;
};

export type NativeQuoteResult = {
  amountIn: bigint;
  amountOut: bigint;
  venueFee: bigint;
  priceImpactBps: number | null;
  /** Free-form venue facts (next sqrt price, bins crossed, …). */
  detail: Record<string, string | number | boolean | null>;
};

export interface NativeCalculator<T = unknown> {
  readonly poolType: PoolType;
  readonly status: CalculatorStatus;
  /** Human-readable statement of what backs the math. */
  readonly basis: string;
  quote(state: NormalizedPoolState<T>, input: NativeQuoteInput): NativeQuoteResult;
}

export interface StateReader<T = unknown> {
  readonly poolType: PoolType;
  /** Decode raw account bytes deterministically. Throws on malformed data. */
  decode(poolAddress: string, account: AccountInfo<Buffer>, extras?: Record<string, AccountInfo<Buffer>>): NormalizedPoolState<T>;
}

/** Deep snake_case → camelCase key rename, preserving BN/PublicKey/Buffer leaves. */
export function camelizeKeys<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelizeKeys(v)) as T;
  if (value && typeof value === "object") {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
    if (ctor && ctor !== "Object") return value as T; // BN, PublicKey, Buffer, Decimal
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k.replace(/^_+/, "").replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = camelizeKeys(v);
    return out as T;
  }
  return value as T;
}

/** The registry of calculators, keyed by pool type. Venues register themselves. */
const calculators = new Map<PoolType, NativeCalculator>();

export function registerCalculator(calculator: NativeCalculator) {
  calculators.set(calculator.poolType, calculator);
}

export function calculatorFor(poolType: PoolType) {
  return calculators.get(poolType) ?? null;
}

export function listCalculators() {
  return [...calculators.values()].map((c) => ({ poolType: c.poolType, status: c.status, basis: c.basis }));
}

export function toRawAmount(value: bigint): RawAmount {
  return value.toString();
}
