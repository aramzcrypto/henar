/**
 * Native state reader + calculator for Meteora DAMM v2 (Task 10, SDK_BACKED).
 * Decoding via the official IDL and Anchor's coder; math via the SDK's pure
 * `swapQuoteExactInput` over Henar-decoded bytes.
 */
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { encodeFixtureAccount } from "@henar/venue-meteora-dbc";
import * as cp from "@meteora-ag/cp-amm-sdk";
import {
  camelizeKeys,
  registerCalculator,
  type NativeCalculator,
  type NativeQuoteInput,
  type NativeQuoteResult,
  type NormalizedPoolState,
  type StateReader,
} from "@henar/router-core";
import { quoteDammV2ExactIn } from "./quote";
import { METEORA_DAMM_V2_PROGRAM, type PoolState } from "./state";

export type DammV2DecodedState = { pool: PoolState; tokenADecimals: number; tokenBDecimals: number };

const coder = new BorshAccountsCoder(cp.CpAmmIdl as never);

export function decodeDammV2Pool(data: Buffer): PoolState {
  return camelizeKeys<PoolState>(coder.decode("Pool", data));
}

/** FIXTURE ONLY: encode a pool back to bytes for decode round-trip tests. */
export async function encodeDammV2Fixture(pool: PoolState): Promise<Buffer> {
  return encodeFixtureAccount(cp.CpAmmIdl as never, coder, "Pool", snakeKeys(pool));
}

function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value && typeof value === "object") {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
    if (ctor && ctor !== "Object") return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = snakeKeys(v);
    return out;
  }
  return value;
}

export const dammV2StateReader: StateReader<DammV2DecodedState> & { withDecimals(a: number, b: number): StateReader<DammV2DecodedState> } = {
  poolType: "damm_v2",
  decode(poolAddress, account) {
    return this.withDecimals(0, 0).decode(poolAddress, account);
  },
  withDecimals(tokenADecimals, tokenBDecimals) {
    return {
      poolType: "damm_v2",
      decode(poolAddress, account) {
        if (account.owner.toBase58() !== METEORA_DAMM_V2_PROGRAM) throw new Error(`account ${poolAddress} is not owned by the DAMM v2 program`);
        return {
          venue: "meteora-damm-v2",
          poolType: "damm_v2",
          poolAddress,
          programId: METEORA_DAMM_V2_PROGRAM,
          slot: null,
          readAt: new Date().toISOString(),
          source: "rpc",
          baseMint: null,
          quoteMint: null,
          decoded: { pool: decodeDammV2Pool(account.data), tokenADecimals, tokenBDecimals },
        };
      },
    };
  },
};

export const dammV2Calculator: NativeCalculator<DammV2DecodedState> = {
  poolType: "damm_v2",
  status: "SDK_BACKED",
  basis: "@meteora-ag/cp-amm-sdk swapQuoteExactInput (pure) over Henar-decoded accounts",
  quote(state: NormalizedPoolState<DammV2DecodedState>, input: NativeQuoteInput): NativeQuoteResult {
    const a = state.decoded.pool.tokenAMint.toBase58();
    const b = state.decoded.pool.tokenBMint.toBase58();
    const pair = new Set([a, b]);
    if (!pair.has(input.inputMint) || !pair.has(input.outputMint)) throw new Error("input/output mints are not the pool pair");
    const c = quoteDammV2ExactIn(
      { pool: state.decoded.pool, aToB: input.inputMint === a, amountIn: input.amountIn, currentPoint: input.currentPoint, tokenADecimals: state.decoded.tokenADecimals, tokenBDecimals: state.decoded.tokenBDecimals },
      cp.swapQuoteExactInput,
    );
    if (c.amountLeft !== 0n) throw new Error("Insufficient Liquidity");
    return {
      amountIn: c.includedFeeInputAmount,
      amountOut: c.outputAmount,
      venueFee: c.claimingFee + c.protocolFee + c.compoundingFee + c.referralFee,
      priceImpactBps: c.priceImpactBps,
      detail: { nextSqrtPrice: c.nextSqrtPrice.toString() },
    };
  },
};

registerCalculator(dammV2Calculator);
