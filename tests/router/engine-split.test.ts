/** Engine split routing with FIXTURE adapters exposing constant-product curves. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT, constantProductCurve, listRouterRepresentations, quoteRepresentation, unavailableQuote, type QuoteContext, type QuoteRequest, type VenueAdapter, type VenueCurve, type VenueQuote, type VerifiedPool } from "@henar/router-core";
import { tradeFee } from "@/lib/trade-fee";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const buy = (amount: string): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint });

/** Two Raydium pools of equal depth, as a curve-capable fixture adapter. */
function poolCurve(address: string, reserveIn: bigint, reserveOut: bigint) {
  return constantProductCurve("raydium", address, reserveIn, reserveOut, 10);
}
function quoteFrom(curve: VenueCurve, request: QuoteRequest, amountIn: bigint): VenueQuote {
  const out = curve.outputFor(amountIn);
  const base = unavailableQuote("raydium", request, "INSUFFICIENT_LIQUIDITY", null, curve.poolAddress);
  if (out === null) return base;
  return { ...base, amountIn: amountIn.toString(), expectedAmountOut: out.toString(), unavailableReason: null, unavailableDetail: null, slot: 1, priceImpactBps: 5, onchainCheckedAtQuote: true, source: "fixture" };
}
function adapter(curves: Record<string, VenueCurve>): VenueAdapter {
  const withQuote = (c: VenueCurve, r: QuoteRequest): VenueCurve => ({ ...c, quoteFor: (amt) => quoteFrom(c, r, amt) });
  return {
    venue: "raydium",
    capabilities: () => ({ venue: "raydium", quote: true, legacyExecution: false, nativeBuild: false, poolTypes: ["clmm"], supportsMinOut: true, supportsToken2022: true }),
    health: async () => ({ venue: "raydium", healthy: true, checkedAt: "", detail: null }),
    getQuote: async (r, ctx) => {
      const pool = ctx.pools[0];
      const c = pool && curves[pool.address];
      return c ? quoteFrom(c, r, BigInt(r.amount)) : unavailableQuote("raydium", r, "NO_VERIFIED_POOL");
    },
    curve: async (r, pool) => (curves[pool.address] ? withQuote(curves[pool.address], r) : null),
    buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }),
  };
}

// The engine reads the committed registry for pools; inject via a wrapper that swaps ctx.pools.
function withPools(a: VenueAdapter, pools: VerifiedPool[]): VenueAdapter {
  const original = a.getQuote.bind(a);
  return { ...a, getQuote: (r, ctx: QuoteContext) => original(r, { ...ctx, pools: ctx.pools.length ? ctx.pools : pools.slice(0, 1) }) };
}
const pool = (address: string): VerifiedPool => ({ id: address, representationId: rep.id, mint: rep.mint, provider: rep.provider, tokenSymbol: rep.tokenSymbol, venue: "raydium", address, programId: key(50), poolType: "clmm", baseMint: rep.mint, quoteMint: USDC_MINT, feeBps: 10, feeConfig: null, observedTokenPrograms: null, tvlUsd: 1e6, discoveredFrom: "f", discoveredAt: "", verifiedAt: "", verification: "ONCHAIN_VERIFIED", onchainVerifiedAt: "x", verificationDetail: null, eligibility: "ROUTER_ELIGIBLE", dbc: null, enabled: true, disabledReason: null });

test("with split routing on, a large order is split across two equal pools and the route beats the best single venue with exact fee accounting", async () => {
  const curves = { [key(1)]: poolCurve(key(1), 1_000_000_000n, 200_000_000n), [key(2)]: poolCurve(key(2), 1_000_000_000n, 200_000_000n) };
  const a = adapter(curves);
  // Simulate the engine's per-pool fan-out by giving it pools through a registry-free path:
  const pools = [pool(key(1)), pool(key(2))];
  const patched = withPools(a, pools);
  const result = await quoteRepresentation(buy("500000000"), { adapters: [patched], enabled: true, splitRouting: true, poolsOverride: pools });
  assert.ok(result.route, "expected a split route");
  {
    assert.equal(result.route.kind, "split");
    assert.equal(result.route.legs.length, 2);
    const legIn = result.route.legs.reduce((s, l) => s + BigInt(l.fees.venueInput), 0n);
    assert.equal(legIn, 500_000_000n - tradeFee(500_000_000n)); // 500 USDC less the Henar fee
    const legFee = result.route.legs.reduce((s, l) => s + BigInt(l.fees.henarInputFee), 0n);
    assert.equal(legFee, tradeFee(500_000_000n)); // charged once across the legs, not per leg
    assert.equal(result.route.fees.henarInputFee, tradeFee(500_000_000n).toString());
    assert.ok(BigInt(result.route.netOutput) > BigInt(result.best!.netOutput));
    for (const leg of result.route.legs) assert.equal(BigInt(leg.fees.userInput), BigInt(leg.fees.venueInput) + BigInt(leg.fees.henarInputFee));
  }
});

test("split routing off → one quote per venue (deepest pool) and no route", async () => {
  const curves = { [key(1)]: poolCurve(key(1), 1_000_000_000n, 200_000_000n), [key(2)]: poolCurve(key(2), 1_000_000_000n, 200_000_000n) };
  const pools = [pool(key(1)), pool(key(2))];
  const result = await quoteRepresentation(buy("500000000"), { adapters: [adapter(curves)], enabled: true, splitRouting: false, poolsOverride: pools });
  assert.equal(result.route, null);
  assert.equal(result.best?.poolAddress, key(1));
  assert.equal(result.alternatives.length, 0);
});

test("a small order is not split even with routing on", async () => {
  const curves = { [key(1)]: poolCurve(key(1), 1_000_000_000n, 200_000_000n), [key(2)]: poolCurve(key(2), 1_000_000_000n, 200_000_000n) };
  const pools = [pool(key(1)), pool(key(2))];
  const result = await quoteRepresentation(buy("1000000"), { adapters: [adapter(curves)], enabled: true, splitRouting: true, poolsOverride: pools });
  assert.equal(result.route, null);
  assert.equal(result.alternatives.length, 1); // both pools quoted, ranked
});
