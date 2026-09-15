/**
 * Meteora DBC state reading — the single place that touches the chain for
 * DBC. The adapter, the lifecycle refresher, the monitoring model and the
 * Studio all read through `readDbcMarket`; nothing else fetches DBC
 * accounts.
 *
 * Uses the official SDK (`@meteora-ag/dynamic-bonding-curve-sdk`) for
 * account decoding and `getCurrentPoint`; no layout is hand-parsed here.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import type BN from "bn.js";
import {
  inspectMints,
  type DbcLifecycleState,
  type MintInspection,
} from "@henar/router-core";

type Sdk = typeof import("@meteora-ag/dynamic-bonding-curve-sdk");
export type VirtualPool = import("@meteora-ag/dynamic-bonding-curve-sdk").VirtualPool;
export type PoolConfig = import("@meteora-ag/dynamic-bonding-curve-sdk").PoolConfig;

let sdkPromise: Promise<Sdk> | null = null;
export function dbcSdk() {
  if (!sdkPromise) sdkPromise = import("@meteora-ag/dynamic-bonding-curve-sdk");
  return sdkPromise;
}

const clients = new WeakMap<Connection, Promise<import("@meteora-ag/dynamic-bonding-curve-sdk").DynamicBondingCurveClient>>();
export function dbcClient(connection: Connection) {
  let existing = clients.get(connection);
  if (!existing) {
    existing = dbcSdk().then((m) => m.DynamicBondingCurveClient.create(connection, "confirmed"));
    clients.set(connection, existing);
  }
  return existing;
}

export const METEORA_DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const METEORA_DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

/** Everything a quote, a lifecycle decision or a monitor needs, read once. */
export type DbcMarketState = {
  poolAddress: string;
  configAddress: string;
  pool: VirtualPool;
  config: PoolConfig;
  /** Slot or unix timestamp per `config.activationType`. */
  currentPoint: bigint;
  slot: number;
  baseMint: MintInspection | null;
  quoteMint: MintInspection | null;
  readAt: string;
};

export type DbcMarketReader = (poolAddress: string) => Promise<DbcMarketState | null>;

export function bn(value: BN | number | bigint) {
  return BigInt(value.toString());
}

/**
 * Read pool + config + current point + both mints. Returns null when the
 * pool account does not exist. Throws on RPC failure so callers can map it
 * to SDK_ERROR / VENUE_TIMEOUT rather than treating it as "no pool".
 */
export async function readDbcMarket(
  connection: Connection,
  poolAddress: string,
): Promise<DbcMarketState | null> {
  const [m, client] = await Promise.all([dbcSdk(), dbcClient(connection)]);
  const pool = await client.state.getPool(new PublicKey(poolAddress));
  if (!pool) return null;
  const configAddress = pool.poolState.config.toBase58();
  const config = await client.state.getPoolConfig(pool.poolState.config);
  if (!config) throw new Error(`DBC config ${configAddress} not found for pool ${poolAddress}`);
  const [currentPoint, slot, mints] = await Promise.all([
    m.getCurrentPoint(connection, config.activationType as 0 | 1),
    connection.getSlot("confirmed"),
    inspectMints(connection, [pool.poolState.baseMint.toBase58(), config.quoteMint.toBase58()]),
  ]);
  return {
    poolAddress,
    configAddress,
    pool,
    config,
    currentPoint: bn(currentPoint),
    slot,
    baseMint: mints[0],
    quoteMint: mints[1],
    readAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pure views over the SDK state, used by quote, lifecycle and monitoring.
// ---------------------------------------------------------------------------

export const BASE_FEE_MODES = ["FeeSchedulerLinear", "FeeSchedulerExponential", "RateLimiter"] as const;
export const COLLECT_FEE_MODES = ["QuoteToken", "OutputToken"] as const;
export const ACTIVATION_TYPES = ["Slot", "Timestamp"] as const;
export const MIGRATION_OPTIONS = ["MET_DAMM", "MET_DAMM_V2"] as const;

export function enumLabel<T extends readonly string[]>(table: T, value: number): T[number] | null {
  return (table[value] as T[number] | undefined) ?? null;
}

export type DbcFacts = {
  baseMint: string;
  quoteMint: string;
  baseReserve: bigint;
  quoteReserve: bigint;
  migrationQuoteThreshold: bigint;
  sqrtPrice: bigint;
  activationPoint: bigint;
  isMigrated: number;
  migrationProgress: number;
  hasSwap: boolean;
  poolType: number;
  tokenType: number;
  quoteTokenFlag: number;
  tokenDecimal: number;
  activationType: number;
  collectFeeMode: number;
  migrationOption: number;
  migrationFeeOption: number;
  baseFeeMode: number;
  dynamicFeeEnabled: boolean;
  finishCurveTimestamp: bigint;
};

/** Flatten the two SDK account objects into plain, typed facts. */
export function dbcFacts(pool: VirtualPool, config: PoolConfig): DbcFacts {
  const s = pool.poolState;
  return {
    baseMint: s.baseMint.toBase58(),
    quoteMint: config.quoteMint.toBase58(),
    baseReserve: bn(s.baseReserve),
    quoteReserve: bn(s.quoteReserve),
    migrationQuoteThreshold: bn(config.migrationQuoteThreshold),
    sqrtPrice: bn(s.sqrtPrice),
    activationPoint: bn(s.activationPoint),
    isMigrated: Number(s.isMigrated),
    migrationProgress: Number(s.migrationProgress),
    hasSwap: Number(s.hasSwap) === 1,
    poolType: Number(s.poolType),
    tokenType: Number(config.tokenType),
    quoteTokenFlag: Number(config.quoteTokenFlag),
    tokenDecimal: Number(config.tokenDecimal),
    activationType: Number(config.activationType),
    collectFeeMode: Number(config.collectFeeMode),
    migrationOption: Number(config.migrationOption),
    migrationFeeOption: Number(config.migrationFeeOption),
    baseFeeMode: Number(config.poolFees.baseFee.baseFeeMode),
    dynamicFeeEnabled: Number(config.poolFees.dynamicFee.initialized) === 1,
    finishCurveTimestamp: bn(s.finishCurveTimestamp),
  };
}

/** Integer basis points of curve completion, capped at 10000. */
export function graduationProgressBps(facts: Pick<DbcFacts, "quoteReserve" | "migrationQuoteThreshold">) {
  if (facts.migrationQuoteThreshold <= 0n) return 0;
  const bps = (facts.quoteReserve * 10_000n) / facts.migrationQuoteThreshold;
  return bps > 10_000n ? 10_000 : Number(bps);
}

export type { DbcLifecycleState };
