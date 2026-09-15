/**
 * Raydium CLMM native state (Task 10) — LIVE_VALIDATION_PENDING.
 *
 * Decoding uses the SDK's own `PoolInfoLayout` (deterministic), but a CLMM
 * quote also needs the tick arrays around the current tick and the bitmap
 * extension, which only an RPC read can supply. The calculator therefore
 * runs the SDK's `PoolUtils.computeAmountOutFormat` over SDK-fetched state
 * and is validated by the Task 11 harness against the adapter's live quote.
 * No tick math is reimplemented here.
 */
import type { AccountInfo } from "@solana/web3.js";
import BN from "bn.js";
import {
  camelizeKeys,
  registerCalculator,
  type NativeCalculator,
  type NativeQuoteInput,
  type NativeQuoteResult,
  type NormalizedPoolState,
  type StateReader,
} from "@henar/router-core";
const RAYDIUM_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

type Sdk = typeof import("@raydium-io/raydium-sdk-v2");
type ComputePoolInfo = import("@raydium-io/raydium-sdk-v2").ComputeClmmPoolInfo;
type TickCache = import("@raydium-io/raydium-sdk-v2").ReturnTypeFetchMultiplePoolTickArrays[string];

export type ClmmDecodedState = {
  /** Decoded `PoolInfoLayout` (camelized). Sufficient for identity, price and liquidity; not for a quote. */
  poolInfo: Record<string, unknown>;
  /** Present only when state came from the SDK's RPC fetch. */
  computePoolInfo: ComputePoolInfo | null;
  tickArrayCache: TickCache | null;
  tokenOut: { address: string; decimals: number; programId: string } | null;
  epochInfo: { epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number } | null;
};

let sdkPromise: Promise<Sdk> | null = null;
export async function raydiumSdk() {
  if (!sdkPromise) sdkPromise = import("@raydium-io/raydium-sdk-v2");
  return sdkPromise;
}

/** Deterministic decode of the pool account only. */
export async function decodeClmmPoolInfo(data: Buffer) {
  const m = await raydiumSdk();
  return camelizeKeys<Record<string, unknown>>(m.PoolInfoLayout.decode(data));
}

export const clmmStateReader: StateReader<ClmmDecodedState> = {
  poolType: "clmm",
  decode(poolAddress: string, account: AccountInfo<Buffer>) {
    if (account.owner.toBase58() !== RAYDIUM_CLMM_PROGRAM) throw new Error(`account ${poolAddress} is not owned by the Raydium CLMM program`);
    // Layout decode is synchronous in the SDK; the async wrapper above exists for the lazy import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("@raydium-io/raydium-sdk-v2") as Sdk;
    return {
      venue: "raydium",
      poolType: "clmm",
      poolAddress,
      programId: RAYDIUM_CLMM_PROGRAM,
      slot: null,
      readAt: new Date().toISOString(),
      source: "rpc",
      baseMint: null,
      quoteMint: null,
      decoded: { poolInfo: camelizeKeys(m.PoolInfoLayout.decode(account.data)), computePoolInfo: null, tickArrayCache: null, tokenOut: null, epochInfo: null },
    };
  },
};

export const clmmCalculator: NativeCalculator<ClmmDecodedState> = {
  poolType: "clmm",
  status: "LIVE_VALIDATION_PENDING",
  basis: "@raydium-io/raydium-sdk-v2 PoolUtils.computeAmountOutFormat over SDK-fetched pool + tick arrays; requires RPC state",
  quote(state: NormalizedPoolState<ClmmDecodedState>, input: NativeQuoteInput): NativeQuoteResult {
    const { computePoolInfo, tickArrayCache, tokenOut, epochInfo } = state.decoded;
    if (!computePoolInfo || !tickArrayCache || !tokenOut || !epochInfo)
      throw new Error("LIVE_VALIDATION_PENDING: CLMM quote needs SDK-fetched tick arrays (no RPC on this device)");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("@raydium-io/raydium-sdk-v2") as Sdk;
    const r = m.PoolUtils.computeAmountOutFormat({
      poolInfo: computePoolInfo,
      tickarrayBitmapExtension: computePoolInfo.exBitmapInfo,
      tickArrayCache,
      amountIn: new BN(input.amountIn.toString()),
      tokenOut: tokenOut as never,
      slippage: 0,
      epochInfo,
      blockTimestamp: Number(input.currentPoint),
      catchLiquidityInsufficient: true,
    });
    if (!r.allTrade) throw new Error("Insufficient Liquidity");
    return {
      amountIn: BigInt(r.realAmountIn.amount.raw.toString()),
      amountOut: BigInt(r.amountOut.amount.raw.toString()),
      venueFee: BigInt(r.fee.raw.toString()),
      priceImpactBps: Math.round(Number(r.priceImpact.toFixed(6)) * 100),
      detail: { executionPrice: r.executionPrice.toFixed(8) },
    };
  },
};

registerCalculator(clmmCalculator);
