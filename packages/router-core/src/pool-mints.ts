/**
 * The two mints a pool account actually trades, read from its own bytes.
 *
 * Verification previously confirmed that a pool account was owned by the
 * expected program and that the two mints the registry *claimed* both existed
 * on chain. It never confirmed the pool traded those mints. A row pointing at
 * a real Whirlpool with entirely different mints therefore passed as
 * ONCHAIN_VERIFIED, and Native execution trusts that record to pick the pool
 * it swaps through.
 *
 * These are fixed-offset reads of published account layouts, kept pure and
 * free of venue SDKs so the verification path stays testable on synthetic
 * accounts. Offsets are cross-checked against the Orca and Raydium SDK
 * decoders on live mainnet accounts by
 * `tests/router/pool-mints.test.ts` fixtures and the cross-check script.
 */
import type { PoolType } from "./types";

const PUBKEY_BYTES = 32;

/** Base58 of a 32-byte public key, without pulling in web3.js. */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out === "" ? "1" : out;
}

/**
 * Offsets of the two mint fields in each layout Henar admits.
 *
 *  Orca Whirlpool: discriminator 8, whirlpoolsConfig 32, bump 1, tickSpacing 2,
 *  tickSpacingSeed 2, feeRate 2, protocolFeeRate 2, liquidity 16, sqrtPrice 16,
 *  tickCurrentIndex 4, protocolFeeOwedA 8, protocolFeeOwedB 8 -> tokenMintA at
 *  101; tokenVaultA 32 and feeGrowthGlobalA 16 follow -> tokenMintB at 181.
 *
 *  Raydium CLMM PoolState: discriminator 8, bump 1, ammConfig 32, owner 32
 *  -> tokenMint0 at 73, tokenMint1 at 105.
 *
 *  Raydium CPMM PoolState: discriminator 8, ammConfig 32, poolCreator 32,
 *  token0Vault 32, token1Vault 32, lpMint 32 -> token0Mint at 168,
 *  token1Mint at 200.
 *
 *  Meteora DLMM LbPair: discriminator 8, parameters (StaticParameters) 32,
 *  vParameters (VariableParameters) 32, bumpSeed 1, binStepSeed 2,
 *  pairType 1, activeId 4, binStep 2, status 1, requireBaseFactorSeed 1,
 *  baseFactorSeed 2, activationType 1, creatorPoolOnOffControl 1
 *  -> tokenXMint at 88, tokenYMint at 120. Confirmed against the live
 *  tOpenAI-USDC pair (2ZWxT3ni…) on 16 September 2026.
 */
const LAYOUTS: Partial<Record<PoolType, { base: number; quote: number }>> = {
  whirlpool: { base: 101, quote: 181 },
  clmm: { base: 73, quote: 105 },
  cpmm: { base: 168, quote: 200 },
  dlmm: { base: 88, quote: 120 },
  /* Byreal CLMM is a Raydium CLMM fork and shares its PoolState layout;
     verified against a live pool, where USDC sits at offset 105. */
  byreal_clmm: { base: 73, quote: 105 },
};

export type DecodedPoolMints = { base: string; quote: string };

/**
 * The pool's own pair, or null when the layout is unknown or the account is
 * too short to hold it. Null means "not confirmed", never "confirmed absent":
 * callers must fail closed rather than treat it as agreement.
 */
export function decodePoolMints(poolType: PoolType, data: Uint8Array): DecodedPoolMints | null {
  const layout = LAYOUTS[poolType];
  if (!layout) return null;
  const end = Math.max(layout.base, layout.quote) + PUBKEY_BYTES;
  if (data.length < end) return null;
  return {
    base: toBase58(data.subarray(layout.base, layout.base + PUBKEY_BYTES)),
    quote: toBase58(data.subarray(layout.quote, layout.quote + PUBKEY_BYTES)),
  };
}

/** True when a decoded pair is the same unordered pair the registry records. */
export function mintsAgree(decoded: DecodedPoolMints, base: string, quote: string) {
  return (
    (decoded.base === base && decoded.quote === quote) ||
    (decoded.base === quote && decoded.quote === base)
  );
}

/** Pool types whose pair this module can confirm. */
export function canDecodePoolMints(poolType: PoolType) {
  return LAYOUTS[poolType] !== undefined;
}
