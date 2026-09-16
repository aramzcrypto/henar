/**
 * The bin-array ladder is the one piece of Meteora logic that is Henar's,
 * not the SDK's, so it is tested against a fake DLMM instance that mimics
 * the SDK's two behaviours: getBinArrayForSwap returns fewer arrays than
 * asked when the pool is exhausted, and swapQuote throws
 * SWAP_QUOTE_INSUFFICIENT_LIQUIDITY when it walks past the loaded arrays.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { BIN_ARRAY_LADDER, MAX_BIN_ARRAYS, cachedBinArrayQuote, quoteWithBinArrays } from "@henar/venue-meteora";

class InsufficientLiquidity extends Error {
  name = "DlmmSdkError";
  constructor() {
    super("SWAP_QUOTE_INSUFFICIENT_LIQUIDITY: Insufficient liquidity in binArrays for swapQuote");
  }
}

/** A pool where each bin array can fill `perArray`, and `available` arrays exist. */
function fakePool(perArray: number, available: number) {
  const calls: number[] = [];
  return {
    calls,
    getBinArrayForSwap: async (_: boolean, count: number) => {
      calls.push(count);
      return Array.from({ length: Math.min(count, available) }, (_v, i) => ({ publicKey: `arr${i}`, account: {} }));
    },
    swapQuote: (amount: BN, _y: boolean, _s: BN, binArrays: unknown[]) => {
      if (amount.toNumber() > perArray * binArrays.length) throw new InsufficientLiquidity();
      return { consumedInAmount: amount, outAmount: amount, fee: new BN(0), protocolFee: new BN(0), minOutAmount: amount, priceImpact: { toString: () => "0" }, binArraysPubkey: [], endPrice: { toString: () => "1" }, feeOnInput: true };
    },
  } as unknown as Parameters<typeof quoteWithBinArrays>[0] & { calls: number[] };
}

test("fills within the default 4 arrays without escalating", async () => {
  const pool = fakePool(100, 100);
  const out = await quoteWithBinArrays(pool, new BN(350), true);
  assert.equal(out.ok, true);
  assert.deepEqual(pool.calls, [4]);
});

test("escalates when 4 loaded arrays were the limit, not the pool", async () => {
  const pool = fakePool(100, 100);
  const out = await quoteWithBinArrays(pool, new BN(1_100), true);
  assert.equal(out.ok, true);
  assert.deepEqual(pool.calls, [4, 8, 16]);
  assert.equal(out.ok && out.binArraysLoaded, 16);
});

test("reports 'exhausted' when the pool returns fewer arrays than asked", async () => {
  const pool = fakePool(100, 3); // pool only has 3 arrays in this direction
  const out = await quoteWithBinArrays(pool, new BN(500), true);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.reason, "exhausted");
  assert.deepEqual(pool.calls, [4]); // no point asking for more
});

test("reports 'bounded' past the ladder and names the bound in the detail", async () => {
  const pool = fakePool(100, 1000);
  const out = await quoteWithBinArrays(pool, new BN(MAX_BIN_ARRAYS * 100 + 1), true);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.reason, "bounded");
  assert.match(!out.ok ? out.detail : "", new RegExp(`${MAX_BIN_ARRAYS} bin arrays`));
  assert.deepEqual(pool.calls, [...BIN_ARRAY_LADDER]);
});

test("non-liquidity SDK errors propagate unchanged", async () => {
  const pool = fakePool(100, 100);
  (pool as { swapQuote: unknown }).swapQuote = () => {
    throw new Error("account not found");
  };
  await assert.rejects(quoteWithBinArrays(pool, new BN(1), true), /account not found/);
});

/* ------------------------------------------------------------------------ *
 * The split optimizer's curve over a DLMM pool.
 *
 * The optimizer splits across curves, and Meteora had none, so no allocation
 * could ever land on it however much liquidity the registry recorded.
 * Meteora DLMM appears in 13% of winning external routes for Henar's listed
 * equities (measured 16 September 2026), so the curve is the difference
 * between seeing that liquidity and not.
 *
 * Bin arrays are fetched once and every allocation is priced off that one
 * read, which is what makes the curve pure and synchronous.
 * ------------------------------------------------------------------------ */

/** A pool that fills up to `capacity` and partially fills beyond it. */
function partialFillPool(capacity: number) {
  return {
    swapQuote: (amount: BN) => {
      const asked = amount.toNumber();
      const consumed = Math.min(asked, capacity);
      if (consumed <= 0) throw new InsufficientLiquidity();
      return {
        consumedInAmount: new BN(consumed),
        outAmount: new BN(consumed * 2),
        fee: new BN(0),
        protocolFee: new BN(0),
        minOutAmount: new BN(consumed * 2),
        priceImpact: { toString: () => "0" },
        binArraysPubkey: [],
        endPrice: { toString: () => "1" },
        feeOnInput: true,
      };
    },
  } as unknown as Parameters<typeof cachedBinArrayQuote>[0];
}

test("the curve prices any amount off one bin-array read", () => {
  const price = cachedBinArrayQuote(partialFillPool(1_000), [] as never, true);
  for (const amount of [1n, 250n, 999n, 1_000n]) {
    const q = price(amount);
    assert.ok(q, `expected a quote at ${amount}`);
    assert.equal(BigInt(q.outAmount.toString()), amount * 2n);
  }
});

test("a partial fill is not an output for the amount asked", () => {
  /* The SDK answers a too-large request by consuming what it can. Reporting
     that as the output for the full amount would overstate the pool and hand
     the optimizer a leg the pool cannot actually settle. */
  const price = cachedBinArrayQuote(partialFillPool(1_000), [] as never, true);
  assert.equal(price(1_001n), null);
  assert.equal(price(50_000n), null);
});

test("no liquidity and non-positive amounts are refused, not guessed", () => {
  const dry = {
    swapQuote: () => {
      throw new InsufficientLiquidity();
    },
  } as unknown as Parameters<typeof cachedBinArrayQuote>[0];
  assert.equal(cachedBinArrayQuote(dry, [] as never, true)(100n), null);
  const price = cachedBinArrayQuote(partialFillPool(1_000), [] as never, true);
  assert.equal(price(0n), null);
  assert.equal(price(-5n), null);
});

test("an error that is not insufficient liquidity is not swallowed as an empty pool", () => {
  /* Treating an RPC or decode failure as "no liquidity" would silently drop a
     healthy venue out of every split. */
  const broken = {
    swapQuote: () => {
      throw new Error("account decode failed");
    },
  } as unknown as Parameters<typeof cachedBinArrayQuote>[0];
  assert.throws(() => cachedBinArrayQuote(broken, [] as never, true)(100n), /account decode failed/);
});
