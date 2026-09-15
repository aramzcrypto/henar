import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SPLIT_OPTIONS, constantProductCurve, optimizeSplit, type VenueCurve } from "@henar/router-core";

// FIXTURE curves: constant-product pools with explicit reserves. Not live.
const deep = (venue: VenueCurve["venue"], fee = 10) => constantProductCurve(venue, "deep", 10_000_000_000n, 2_000_000_000n, fee); // 10k USDC / 2k shares
const shallow = (venue: VenueCurve["venue"], fee = 10) => constantProductCurve(venue, "shallow", 100_000_000n, 20_000_000n, fee); // 100 USDC / 20 shares
const opts = { ...DEFAULT_SPLIT_OPTIONS, granularity: 20, maxLegs: 2 };

test("one venue clearly best → single, no split", () => {
  const r = optimizeSplit([deep("raydium"), shallow("meteora")], 1_000_000n, opts);
  assert.equal(r.kind, "single");
  assert.equal(r.legs[0].venue, "raydium");
  assert.equal(r.legs[0].percentBps, 10_000);
  assert.equal(r.totalOut, r.bestSingleOut);
});

test("two equal-depth venues split ~50/50 on a large order and beat the best single by more than the threshold", () => {
  const a = constantProductCurve("raydium", "a", 1_000_000_000n, 200_000_000n, 10);
  const b = constantProductCurve("meteora-damm-v2", "b", 1_000_000_000n, 200_000_000n, 10);
  const r = optimizeSplit([a, b], 500_000_000n, opts);
  assert.equal(r.kind, "split");
  assert.equal(r.legs.length, 2);
  assert.equal(r.legs[0].percentBps + r.legs[1].percentBps, 10_000);
  assert.ok(Math.abs(r.legs[0].percentBps - 5_000) <= 500, `${r.legs[0].percentBps}`);
  assert.ok(BigInt(r.totalOut) > BigInt(r.bestSingleOut!));
  assert.ok(r.improvementBps! > 0, `${r.improvementBps}`);
  assert.equal(r.costBps, 0);
  assert.equal(r.netImprovementBps, r.improvementBps);
  // Exact accounting: leg inputs sum to the order, leg outputs sum to total.
  assert.equal(r.legs.reduce((s, l) => s + BigInt(l.amountIn), 0n), 500_000_000n);
  assert.equal(r.legs.reduce((s, l) => s + BigInt(l.amountOut), 0n), BigInt(r.totalOut));
});

test("three venues with maxLegs 3 can use all three; with maxLegs 2 never opens a third leg", () => {
  const curves = [
    constantProductCurve("raydium", "a", 1_000_000_000n, 200_000_000n, 10),
    constantProductCurve("meteora-damm-v2", "b", 1_000_000_000n, 200_000_000n, 10),
    constantProductCurve("meteora", "c", 1_000_000_000n, 200_000_000n, 10),
  ];
  const three = optimizeSplit(curves, 900_000_000n, { ...opts, maxLegs: 3 });
  assert.equal(three.kind, "split");
  assert.equal(three.legs.length, 3);
  const two = optimizeSplit(curves, 900_000_000n, { ...opts, maxLegs: 2 });
  assert.ok(two.legs.length <= 2);
  assert.ok(BigInt(three.totalOut) >= BigInt(two.totalOut));
});

test("shallow liquidity: a venue that cannot fill is skipped per chunk, and an unfillable order is refused, not partially filled", () => {
  const r = optimizeSplit([deep("raydium"), shallow("meteora")], 50_000_000_000n, opts); // 50k USDC > every pool
  assert.equal(r.kind, "none");
  assert.match(r.reason, /no venue can fill/);
  const tight = constantProductCurve("meteora", "tight", 1_000_000_000n, 200_000_000n, 10);
  const only = { ...deep("raydium"), outputFor: () => null } as VenueCurve;
  const r2 = optimizeSplit([only, tight], 100_000_000n, opts);
  assert.equal(r2.kind, "single");
  assert.equal(r2.legs[0].venue, "meteora");
});

test("identical routes: deterministic tie-break by venue order", () => {
  const a = constantProductCurve("raydium", "a", 1_000_000_000n, 200_000_000n, 10);
  const b = constantProductCurve("meteora", "b", 1_000_000_000n, 200_000_000n, 10);
  // Too small for a second leg to add anything: one venue takes it all, and
  // which one is decided by order, not by chance.
  const small = optimizeSplit([a, b], 100_000n, opts);
  assert.equal(small.kind, "single");
  assert.equal(small.legs[0].venue, "raydium");
  const reversed = optimizeSplit([b, a], 100_000n, opts);
  assert.equal(reversed.legs[0].venue, "meteora");
});

/**
 * The optimizer reports; it does not decide.
 *
 * It used to collapse a split back to the single best venue whenever the gain
 * fell under a threshold, which discarded the number the caller needs. An
 * AAPLx split that beat Jupiter by 5.95 bps was thrown away for improving the
 * best single native pool by only 2 bps, a comparison against the wrong
 * baseline: the optimizer cannot see the venues it is unable to split across.
 */
test("a small but real improvement is returned, with what it is worth", () => {
  const a = constantProductCurve("raydium", "a", 1_000_000_000n, 200_000_000n, 10);
  const b = constantProductCurve("meteora", "b", 1_000_000_000n, 200_000_000n, 10);
  const small = optimizeSplit([a, b], 20_000_000n, opts);
  assert.equal(small.kind, "split");
  assert.ok(small.improvementBps! > 0, `${small.improvementBps}`);
  assert.ok(BigInt(small.totalOut) > BigInt(small.bestSingleOut!));
  // Nothing is deducted unless the caller supplies a real cost.
  assert.equal(small.costBps, 0);

  // A caller that can estimate the incremental network cost gets it applied
  // to netImprovementBps, while the construction itself is still reported.
  const costed = optimizeSplit([a, b], 20_000_000n, { ...opts, extraLegCostBps: 10_000 });
  assert.equal(costed.kind, "split");
  assert.equal(costed.costBps, 10_000);
  assert.ok(costed.netImprovementBps! < 0);
  assert.ok(Math.abs(costed.improvementBps! - (costed.netImprovementBps! + 10_000)) < 1e-6);
});

test("a split that does not beat the single venue is not called an improvement", () => {
  // One pool strictly deeper than the other at every size.
  const deepPool = constantProductCurve("raydium", "a", 10n ** 15n, 10n ** 15n, 0);
  const thin = constantProductCurve("meteora", "b", 10n ** 6n, 10n ** 6n, 9_000);
  const r = optimizeSplit([deepPool, thin], 1_000_000n, opts);
  assert.equal(r.kind, "single");
  assert.equal(r.legs[0].venue, "raydium");
});

test("unavailable venues are ignored and reported", () => {
  const down = constantProductCurve("meteora-dbc", "d", 10n ** 12n, 10n ** 12n, 0, false, "POOL_GRADUATED");
  const r = optimizeSplit([down, deep("raydium")], 1_000_000n, opts);
  assert.equal(r.kind, "single");
  assert.equal(r.legs[0].venue, "raydium");
  assert.deepEqual(r.excluded, [{ venue: "meteora-dbc", reason: "POOL_GRADUATED" }]);
  assert.equal(optimizeSplit([down], 1n, opts).kind, "none");
});

test("fee differences decide between otherwise identical venues", () => {
  const cheap = constantProductCurve("raydium", "a", 1_000_000_000n, 200_000_000n, 10);
  const dear = constantProductCurve("meteora", "b", 1_000_000_000n, 200_000_000n, 100);
  const r = optimizeSplit([dear, cheap], 10_000_000n, opts);
  assert.equal(r.legs[0].venue, "raydium");
});

test("price-impact curves: allocation follows marginal output; granularity changes precision, not correctness", () => {
  const big = constantProductCurve("raydium", "a", 4_000_000_000n, 800_000_000n, 10);
  const small = constantProductCurve("meteora", "b", 1_000_000_000n, 200_000_000n, 10);
  const coarse = optimizeSplit([big, small], 1_000_000_000n, { ...opts, granularity: 4 });
  const fine = optimizeSplit([big, small], 1_000_000_000n, { ...opts, granularity: 100 });
  assert.equal(fine.kind, "split");
  assert.ok(fine.legs.find((l) => l.venue === "raydium")!.percentBps > fine.legs.find((l) => l.venue === "meteora")!.percentBps);
  assert.ok(BigInt(fine.totalOut) >= BigInt(coarse.totalOut));
});

test("deterministic rounding: chunk remainder lands on the last chunk so inputs always sum exactly", () => {
  const a = constantProductCurve("raydium", "a", 1_000_000_000n, 200_000_000n, 10);
  const b = constantProductCurve("meteora", "b", 1_000_000_000n, 200_000_000n, 10);
  for (const amount of [999_999_999n, 7n, 123_456_789n]) {
    const r = optimizeSplit([a, b], amount, { ...opts, granularity: 7 });
    if (r.kind !== "none") assert.equal(r.legs.reduce((s, l) => s + BigInt(l.amountIn), 0n), amount);
  }
  const once = optimizeSplit([a, b], 500_000_000n, opts);
  const again = optimizeSplit([a, b], 500_000_000n, opts);
  assert.deepEqual(once, again);
  assert.equal(optimizeSplit([a], 0n, opts).kind, "none");
});
