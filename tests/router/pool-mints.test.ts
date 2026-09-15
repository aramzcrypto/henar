/**
 * Fixed-offset pool-pair decoding.
 *
 * The offsets are cross-checked against the Orca and Raydium SDK decoders on
 * live mainnet accounts (12 of 12 agreed across whirlpool, clmm and cpmm);
 * these tests pin the byte positions so a refactor cannot silently move them,
 * and pin the fail-closed behaviour on anything unrecognised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { canDecodePoolMints, decodePoolMints, mintsAgree } from "@henar/router-core";

const A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const B = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

function account(offsets: { base: number; quote: number }, base: string, quote: string, bytes = 1544) {
  const data = Buffer.alloc(bytes);
  new PublicKey(base).toBuffer().copy(data, offsets.base);
  new PublicKey(quote).toBuffer().copy(data, offsets.quote);
  return data;
}

test("each admitted layout is read at its published offsets", () => {
  const cases: [Parameters<typeof decodePoolMints>[0], { base: number; quote: number }][] = [
    ["whirlpool", { base: 101, quote: 181 }],
    ["clmm", { base: 73, quote: 105 }],
    ["cpmm", { base: 168, quote: 200 }],
  ];
  for (const [poolType, offsets] of cases) {
    assert.equal(canDecodePoolMints(poolType), true, poolType);
    const decoded = decodePoolMints(poolType, account(offsets, A, B));
    assert.deepEqual(decoded, { base: A, quote: B }, poolType);
  }
});

test("an unknown layout or a short account decodes to null, never to a guess", () => {
  assert.equal(canDecodePoolMints("dlmm"), false);
  assert.equal(decodePoolMints("dlmm", account({ base: 73, quote: 105 }, A, B)), null);
  assert.equal(decodePoolMints("clmm", Buffer.alloc(8)), null);
  assert.equal(decodePoolMints("clmm", Buffer.alloc(136)), null); // one byte short of quote+32
  assert.notEqual(decodePoolMints("clmm", Buffer.alloc(137)), null);
});

test("agreement is on the unordered pair", () => {
  const decoded = { base: A, quote: B };
  assert.equal(mintsAgree(decoded, A, B), true);
  assert.equal(mintsAgree(decoded, B, A), true);
  assert.equal(mintsAgree(decoded, A, A), false);
  assert.equal(mintsAgree(decoded, A, "So11111111111111111111111111111111111111112"), false);
});

test("base58 encoding matches PublicKey, including leading zero bytes", () => {
  const offsets = { base: 73, quote: 105 };
  const leadingZero = Buffer.alloc(32);
  leadingZero[31] = 1;
  const data = Buffer.alloc(1544);
  leadingZero.copy(data, offsets.base);
  new PublicKey(B).toBuffer().copy(data, offsets.quote);
  const decoded = decodePoolMints("clmm", data);
  assert.equal(decoded?.base, new PublicKey(leadingZero).toBase58());
  assert.equal(decoded?.quote, B);
  const zeros = Buffer.alloc(1544);
  assert.equal(decodePoolMints("clmm", zeros)?.base, PublicKey.default.toBase58());
});
