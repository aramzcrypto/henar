/**
 * Meteora DAMM v2 (cp-amm) state reading — the single chain touchpoint for
 * DAMM v2. Distinct from DLMM (`@henar/venue-meteora`) and from DBC; a DBC
 * pool graduates into one of these.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import type BN from "bn.js";
import { inspectMints, type MintInspection } from "@henar/router-core";

type Sdk = typeof import("@meteora-ag/cp-amm-sdk");
export type PoolState = import("@meteora-ag/cp-amm-sdk").PoolState;

let sdkPromise: Promise<Sdk> | null = null;
export function cpAmmSdk() {
  if (!sdkPromise) sdkPromise = import("@meteora-ag/cp-amm-sdk");
  return sdkPromise;
}

const clients = new WeakMap<Connection, Promise<import("@meteora-ag/cp-amm-sdk").CpAmm>>();
export function cpAmmClient(connection: Connection) {
  let existing = clients.get(connection);
  if (!existing) {
    existing = cpAmmSdk().then((m) => new m.CpAmm(connection));
    clients.set(connection, existing);
  }
  return existing;
}

export const METEORA_DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

export type DammV2MarketState = {
  poolAddress: string;
  pool: PoolState;
  currentPoint: bigint;
  slot: number;
  tokenA: MintInspection | null;
  tokenB: MintInspection | null;
  readAt: string;
};

export type DammV2MarketReader = (poolAddress: string) => Promise<DammV2MarketState | null>;

export function bn(value: BN | number | bigint) {
  return BigInt(value.toString());
}

export async function readDammV2Pool(connection: Connection, poolAddress: string): Promise<DammV2MarketState | null> {
  const [m, client] = await Promise.all([cpAmmSdk(), cpAmmClient(connection)]);
  const address = new PublicKey(poolAddress);
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) return null;
  if (account.owner.toBase58() !== METEORA_DAMM_V2_PROGRAM)
    throw new Error(`account ${poolAddress} is owned by ${account.owner.toBase58()}, not DAMM v2`);
  const pool = await client.fetchPoolState(address);
  const [currentPoint, slot, mints] = await Promise.all([
    m.getCurrentPoint(connection, Number(pool.activationType) as 0 | 1),
    connection.getSlot("confirmed"),
    inspectMints(connection, [pool.tokenAMint.toBase58(), pool.tokenBMint.toBase58()]),
  ]);
  return {
    poolAddress,
    pool,
    currentPoint: bn(currentPoint),
    slot,
    tokenA: mints[0],
    tokenB: mints[1],
    readAt: new Date().toISOString(),
  };
}

export const POOL_STATUS = ["Enable", "Disable"] as const;
export const ACTIVATION_TYPES = ["Slot", "Timestamp"] as const;
export const COLLECT_FEE_MODES = ["QuoteToken", "OutputToken", "Compounding"] as const;

export function enumLabel<T extends readonly string[]>(table: T, value: number): T[number] | null {
  return (table[value] as T[number] | undefined) ?? null;
}

export type DammV2Facts = {
  tokenAMint: string;
  tokenBMint: string;
  tokenAFlag: number;
  tokenBFlag: number;
  poolStatus: number;
  activationType: number;
  activationPoint: bigint;
  sqrtPrice: bigint;
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  liquidity: bigint;
  tokenAAmount: bigint | null;
  tokenBAmount: bigint | null;
  collectFeeMode: number;
  feeVersion: number;
  layoutVersion: number;
  dynamicFeeEnabled: boolean;
};

export function dammV2Facts(pool: PoolState): DammV2Facts {
  const layoutVersion = Number(pool.layoutVersion);
  return {
    tokenAMint: pool.tokenAMint.toBase58(),
    tokenBMint: pool.tokenBMint.toBase58(),
    tokenAFlag: Number(pool.tokenAFlag),
    tokenBFlag: Number(pool.tokenBFlag),
    poolStatus: Number(pool.poolStatus),
    activationType: Number(pool.activationType),
    activationPoint: bn(pool.activationPoint),
    sqrtPrice: bn(pool.sqrtPrice),
    sqrtMinPrice: bn(pool.sqrtMinPrice),
    sqrtMaxPrice: bn(pool.sqrtMaxPrice),
    liquidity: bn(pool.liquidity),
    // Layout 0 pools did not track reserves; report null rather than 0.
    tokenAAmount: layoutVersion >= 1 ? bn(pool.tokenAAmount) : null,
    tokenBAmount: layoutVersion >= 1 ? bn(pool.tokenBAmount) : null,
    collectFeeMode: Number(pool.collectFeeMode),
    feeVersion: Number(pool.feeVersion),
    layoutVersion,
    dynamicFeeEnabled: Number(pool.poolFees.dynamicFee.initialized) === 1,
  };
}
