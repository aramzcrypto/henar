/**
 * Native state reader + calculator for Meteora DBC (Task 10, SDK_BACKED).
 *
 * Decoding: the official IDL through Anchor's BorshAccountsCoder — no
 * hand-written layout. Keys are camelized to the shape the SDK's pure
 * `swapQuoteExactIn` expects, so the same math the adapter uses runs on
 * Henar-decoded bytes. Deterministic; testable with encoded fixtures.
 */
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  camelizeKeys,
  registerCalculator,
  type NativeCalculator,
  type NativeQuoteInput,
  type NativeQuoteResult,
  type NormalizedPoolState,
  type StateReader,
} from "@henar/router-core";
import { quoteDbcExactIn } from "./quote";
import { METEORA_DBC_PROGRAM, type PoolConfig, type VirtualPool } from "./state";

export type DbcDecodedState = { pool: VirtualPool; config: PoolConfig; configAddress: string };

const coder = new BorshAccountsCoder(dbc.DynamicBondingCurveIdl as never);

export function decodeVirtualPool(data: Buffer): VirtualPool {
  const name = coder.accountDiscriminator("VirtualPool").equals(data.subarray(0, 8)) ? "VirtualPool" : "TransferHookPool";
  return camelizeKeys<VirtualPool>(coder.decode(name, data));
}

export function decodePoolConfig(data: Buffer): PoolConfig {
  if (coder.accountDiscriminator("PoolConfig").equals(data.subarray(0, 8))) return camelizeKeys<PoolConfig>(coder.decode("PoolConfig", data));
  const withHook = camelizeKeys<{ config: PoolConfig }>(coder.decode("ConfigWithTransferHook", data));
  return withHook.config;
}

/** FIXTURE ONLY: encode a pool/config back to bytes for decode round-trip tests. */
export async function encodeDbcFixture(pool: VirtualPool, config: PoolConfig): Promise<{ pool: Buffer; config: Buffer }> {
  const idl = dbc.DynamicBondingCurveIdl as never;
  return {
    pool: encodeFixtureAccount(idl, coder, "VirtualPool", snakeKeys(pool)),
    config: encodeFixtureAccount(idl, coder, "PoolConfig", snakeKeys(config)),
  };
}

/**
 * FIXTURE ONLY. Anchor's `encode` uses a fixed 1000-byte buffer and requires
 * every layout field. Walk the IDL to zero-fill fields a synthetic fixture
 * leaves out (padding arrays, unused vesting blocks), then encode through
 * the coder's own layout into a large buffer.
 */
export function encodeFixtureAccount(idl: { accounts: { name: string }[]; types: { name: string; type: unknown }[] }, coder: BorshAccountsCoder, name: string, value: unknown): Buffer {
  const types = new Map(idl.types.map((t) => [t.name, t.type as { kind: string; fields?: { name: string; type: unknown }[] }]));
  const zero = (type: unknown): unknown => {
    if (typeof type === "string") {
      if (["u8", "u16", "u32", "i8", "i16", "i32", "bool"].includes(type)) return type === "bool" ? false : 0;
      if (["u64", "u128", "i64", "i128"].includes(type)) return new BN(0);
      if (type === "pubkey") return PublicKey.default;
      return 0;
    }
    const t = type as { array?: [unknown, number]; defined?: { name: string }; option?: unknown };
    if (t.array) return Array.from({ length: t.array[1] }, () => zero(t.array![0]));
    if (t.defined) return fill(t.defined.name, {});
    return null;
  };
  const fill = (typeName: string, given: unknown): unknown => {
    const def = types.get(typeName);
    if (!def || def.kind !== "struct" || !def.fields) return given;
    const src = (given ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const f of def.fields) {
      const camel = f.name.replace(/^_+/, "").replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      let v = src[f.name] ?? src[camel];
      const ft = f.type as { array?: [unknown, number]; defined?: { name: string } };
      if (ft.array && (!Array.isArray(v) || v.length !== ft.array[1])) v = zero(ft);
      else if (ft.defined) v = fill(ft.defined.name, v);
      else if (v === undefined) v = zero(f.type);
      out[f.name] = v;
    }
    return out;
  };
  const layouts = (coder as unknown as { accountLayouts: Map<string, { layout: { encode(v: unknown, b: Buffer): number } }> }).accountLayouts;
  const layout = layouts.get(name)?.layout;
  if (!layout) throw new Error(`no layout for ${name}`);
  const body = Buffer.alloc(8192);
  const len = layout.encode(fill(name, value), body);
  return Buffer.concat([coder.accountDiscriminator(name), body.subarray(0, len)]);
}


export function snakeKeys(value: unknown): unknown {
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

export const dbcStateReader: StateReader<DbcDecodedState> = {
  poolType: "dbc",
  decode(poolAddress, account, extras) {
    if (account.owner.toBase58() !== METEORA_DBC_PROGRAM) throw new Error(`account ${poolAddress} is not owned by the DBC program`);
    const pool = decodeVirtualPool(account.data);
    const configAddress = pool.poolState.config.toBase58();
    const configAccount = extras?.[configAddress];
    if (!configAccount) throw new Error(`DBC config account ${configAddress} must be supplied with the pool`);
    const config = decodePoolConfig(configAccount.data);
    return {
      venue: "meteora-dbc",
      poolType: "dbc",
      poolAddress,
      programId: METEORA_DBC_PROGRAM,
      slot: null,
      readAt: new Date().toISOString(),
      source: "rpc",
      baseMint: null,
      quoteMint: null,
      decoded: { pool, config, configAddress },
    };
  },
};

export const dbcCalculator: NativeCalculator<DbcDecodedState> = {
  poolType: "dbc",
  status: "SDK_BACKED",
  basis: "@meteora-ag/dynamic-bonding-curve-sdk swapQuoteExactIn (pure) over Henar-decoded accounts",
  quote(state: NormalizedPoolState<DbcDecodedState>, input: NativeQuoteInput): NativeQuoteResult {
    const baseMint = state.decoded.pool.poolState.baseMint.toBase58();
    const quoteMint = state.decoded.config.quoteMint.toBase58();
    const pair = new Set([baseMint, quoteMint]);
    if (!pair.has(input.inputMint) || !pair.has(input.outputMint)) throw new Error("input/output mints are not the pool pair");
    const c = quoteDbcExactIn(
      { pool: state.decoded.pool, config: state.decoded.config, swapBaseForQuote: input.inputMint === baseMint, amountIn: input.amountIn, currentPoint: input.currentPoint },
      dbc.swapQuoteExactIn,
    );
    if (c.amountLeft !== 0n) throw new Error("Insufficient Liquidity");
    return {
      amountIn: c.includedFeeInputAmount,
      amountOut: c.outputAmount,
      venueFee: c.tradingFee + c.protocolFee + c.referralFee,
      priceImpactBps: c.priceImpactBps,
      detail: { nextSqrtPrice: c.nextSqrtPrice.toString(), feeOnInput: c.feeOnInput },
    };
  },
};

registerCalculator(dbcCalculator);
