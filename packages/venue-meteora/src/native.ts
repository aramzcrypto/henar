/**
 * Meteora DLMM native state (Task 10) — LIVE_VALIDATION_PENDING.
 *
 * `LbPair` decodes deterministically through the official IDL, but a quote
 * needs the bin arrays around the active bin, which only RPC supplies. The
 * calculator runs the SDK's `swapQuote` over SDK-fetched bin arrays and is
 * validated live by the Task 11 harness. No bin math is reimplemented.
 */
import { BorshAccountsCoder } from "@coral-xyz/anchor";
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
const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

type DlmmModule = typeof import("@meteora-ag/dlmm");
type Dlmm = InstanceType<DlmmModule["default"]>;
type BinArrayAccount = import("@meteora-ag/dlmm").BinArrayAccount;

export type DlmmDecodedState = {
  lbPair: Record<string, unknown>;
  /** SDK instance and bin arrays, present only after an RPC read. */
  instance: Dlmm | null;
  binArrays: BinArrayAccount[] | null;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dlmmModule = require("@meteora-ag/dlmm") as DlmmModule & { IDL: unknown };
const coder = new BorshAccountsCoder(dlmmModule.IDL as never);

export function decodeLbPair(data: Buffer) {
  return camelizeKeys<Record<string, unknown>>(coder.decode("LbPair", data));
}

export const dlmmStateReader: StateReader<DlmmDecodedState> = {
  poolType: "dlmm",
  decode(poolAddress: string, account: AccountInfo<Buffer>) {
    if (account.owner.toBase58() !== METEORA_DLMM_PROGRAM) throw new Error(`account ${poolAddress} is not owned by the DLMM program`);
    return {
      venue: "meteora",
      poolType: "dlmm",
      poolAddress,
      programId: METEORA_DLMM_PROGRAM,
      slot: null,
      readAt: new Date().toISOString(),
      source: "rpc",
      baseMint: null,
      quoteMint: null,
      decoded: { lbPair: decodeLbPair(account.data), instance: null, binArrays: null },
    };
  },
};

export const dlmmCalculator: NativeCalculator<DlmmDecodedState> = {
  poolType: "dlmm",
  status: "LIVE_VALIDATION_PENDING",
  basis: "@meteora-ag/dlmm swapQuote over SDK-fetched bin arrays; requires RPC state",
  quote(state: NormalizedPoolState<DlmmDecodedState>, input: NativeQuoteInput): NativeQuoteResult {
    const { instance, binArrays } = state.decoded;
    if (!instance || !binArrays) throw new Error("LIVE_VALIDATION_PENDING: DLMM quote needs SDK-fetched bin arrays (no RPC on this device)");
    const x = instance.tokenX.publicKey.toBase58();
    const q = instance.swapQuote(new BN(input.amountIn.toString()), input.inputMint === x, new BN(0), binArrays, false);
    const consumed = BigInt(q.consumedInAmount.toString());
    if (consumed !== input.amountIn) throw new Error("Insufficient Liquidity");
    const impact = Number(q.priceImpact.toString());
    return {
      amountIn: consumed,
      amountOut: BigInt(q.outAmount.toString()),
      venueFee: BigInt(q.fee.toString()),
      priceImpactBps: Number.isFinite(impact) ? Math.round(impact * 100) : null,
      detail: { binArrays: q.binArraysPubkey.length },
    };
  },
};

registerCalculator(dlmmCalculator);
