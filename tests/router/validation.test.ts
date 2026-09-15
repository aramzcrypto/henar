import { test } from "node:test";
import assert from "node:assert/strict";
import { compareQuotes, summarizeComparisons } from "@henar/router-core";

const base = { representationId: "r", venue: "meteora-dbc" as const, poolAddress: "p", side: "buy" as const, amountIn: "1000000", now: 0 };

test("SDK_BACKED requires exact raw equality; a 1-unit difference fails", () => {
  const exact = compareQuotes({ ...base, calculatorStatus: "SDK_BACKED", native: { amountOut: "500", slot: 1, error: null }, sdk: { amountOut: "500", slot: 1, error: null } });
  assert.equal(exact.pass, true);
  assert.equal(exact.nativeVsSdkRaw, "0");
  assert.equal(exact.toleranceBps, 0);
  const off = compareQuotes({ ...base, calculatorStatus: "SDK_BACKED", native: { amountOut: "501", slot: 1, error: null }, sdk: { amountOut: "500", slot: 1, error: null } });
  assert.equal(off.pass, false);
  assert.equal(off.nativeVsSdkRaw, "1");
  assert.equal(off.nativeVsSdkBps, 20);
});

test("LIVE_VALIDATION_PENDING allows the configured bps but not more, and flags slot mismatch", () => {
  const within = compareQuotes({ ...base, venue: "raydium", calculatorStatus: "LIVE_VALIDATION_PENDING", native: { amountOut: "1000000", slot: 5, error: null }, sdk: { amountOut: "1000050", slot: 5, error: null } });
  assert.equal(within.pass, true);
  const beyond = compareQuotes({ ...base, venue: "raydium", calculatorStatus: "LIVE_VALIDATION_PENDING", native: { amountOut: "1000000", slot: 5, error: null }, sdk: { amountOut: "1000200", slot: 5, error: null } });
  assert.equal(beyond.pass, false);
  const slots = compareQuotes({ ...base, venue: "raydium", calculatorStatus: "LIVE_VALIDATION_PENDING", native: { amountOut: "1000000", slot: 5, error: null }, sdk: { amountOut: "1000000", slot: 6, error: null } });
  assert.equal(slots.pass, false);
  assert.match(slots.reason, /slots differ/);
});

test("both unavailable passes only when the reasons agree; one-sided unavailability fails", () => {
  const agree = compareQuotes({ ...base, calculatorStatus: "SDK_BACKED", native: { amountOut: null, slot: null, error: "Insufficient Liquidity" }, sdk: { amountOut: null, slot: null, error: "Insufficient Liquidity" } });
  assert.equal(agree.pass, true);
  const disagree = compareQuotes({ ...base, calculatorStatus: "SDK_BACKED", native: { amountOut: null, slot: null, error: "Insufficient Liquidity" }, sdk: { amountOut: null, slot: null, error: "Virtual pool is completed" } });
  assert.equal(disagree.pass, false);
  const oneSided = compareQuotes({ ...base, calculatorStatus: "SDK_BACKED", native: { amountOut: "1", slot: 1, error: null }, sdk: { amountOut: null, slot: 1, error: "x" } });
  assert.equal(oneSided.pass, false);
});

test("fixture runs are never live: reason is prefixed and the gate stays closed", () => {
  const r = compareQuotes({ ...base, calculatorStatus: "SDK_BACKED", native: { amountOut: "5", slot: 1, error: null }, sdk: { amountOut: "5", slot: 1, error: null }, jupiter: { amountOut: "4", slot: 1, error: null } });
  assert.equal(r.live, false);
  assert.match(r.reason, /^LIVE_VALIDATION_PENDING/);
  assert.equal(r.nativeVsJupiterBps, 2500);
  const s = summarizeComparisons([r, r]);
  assert.equal(s.pass, 2);
  assert.equal(s.liveRecords, 0);
  assert.equal(s.gatePassed, false);
  const live = summarizeComparisons([{ ...r, live: true }]);
  assert.equal(live.gatePassed, true);
  assert.equal(summarizeComparisons([]).gatePassed, false);
});
