import { test } from "node:test";
import assert from "node:assert/strict";
import { U64_MAX, bpsOf, fromRaw, toRaw } from "@henar/router-core";

test("raw amounts round-trip as u64 decimal strings only", () => {
  assert.equal(toRaw(0n), "0");
  assert.equal(fromRaw("18446744073709551615"), U64_MAX);
  assert.throws(() => fromRaw("18446744073709551616"), /u64/);
  assert.throws(() => toRaw(-1n), /u64/);
  assert.throws(() => fromRaw("1.5"), /Malformed/);
  assert.throws(() => fromRaw("1e6"), /Malformed/);
  assert.throws(() => fromRaw(""), /Malformed/);
  assert.throws(() => fromRaw("-1"), /Malformed/);
});

test("bpsOf rounds down and bounds its inputs", () => {
  assert.equal(bpsOf(100_000_000n, 15), 150_000n);
  assert.equal(bpsOf(1n, 15), 0n);
  assert.equal(bpsOf(6_666n, 15), 9n); // 9.999 → 9
  assert.throws(() => bpsOf(1n, -1));
  assert.throws(() => bpsOf(1n, 10_001));
  assert.throws(() => bpsOf(1n, 1.5));
});
