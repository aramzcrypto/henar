import { test } from "node:test";
import assert from "node:assert/strict";
import { luckyPayout, canReserveLucky, LUCKY_OUTCOMES } from "../src/lib/lucky";
import { actionSchema } from "../src/lib/protocol/prepare";
test("Lucky odds conserve the exact escrow and yield 95% average before the initial fee", () => {
  const stake = 9_800_000n;
  const counts = new Map<bigint, number>();
  let total = 0n;
  for (let bucket = 0; bucket < 100; bucket++) {
    const payout = luckyPayout(stake, bucket);
    total += payout;
    counts.set(payout, (counts.get(payout) ?? 0) + 1);
    assert.equal(payout + (stake * 2n - payout), stake * 2n);
  }
  assert.equal(total, stake * 95n);
  assert.deepEqual(
    [...counts.values()],
    LUCKY_OUTCOMES.map((o) => o.probability),
  );
  assert.equal(total / 100n, 9_310_000n);
});
test("Lucky exact integer bounds and reserve capacity", () => {
  assert.equal(luckyPayout(5n, 0), 1n);
  assert.equal(luckyPayout(5n, 79), 7n);
  for (const bucket of [-1, 100, NaN, 2.5])
    assert.throws(() => luckyPayout(10n, bucket));
  assert.throws(() => luckyPayout(0n, 0));
  assert.throws(() => luckyPayout((1n << 64n) - 1n, 99));
  assert.equal(canReserveLucky(98n, 97n, 200n), false);
  assert.equal(canReserveLucky(98n, 98n, 200n), true);
  assert.equal(canReserveLucky(201n, 1000n, 200n), false);
});
test("Lucky rolls require explicit actions; callers cannot submit odds or outcomes", () => {
  const input = actionSchema.parse({
    action: "open",
    owner: "wallet",
    lucky: true,
    bucket: 99,
  });
  assert.equal(input.action, "open");
  assert.equal("bucket" in input, false);
  assert.equal("lucky" in input, false);
  for (const action of [
    "openLucky",
    "bankLucky",
    "rollLucky",
    "resolveLucky",
    "refundLucky",
  ])
    assert.equal(
      actionSchema.parse({ action, owner: "wallet" }).action,
      action,
    );
});
