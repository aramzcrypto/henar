/** Task 22: circuit breakers, metrics, health/ready — deterministic clock. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker, Metrics, RouterHealth } from "@henar/router-app";

test("circuit breaker: opens after the threshold, half-opens after openMs, closes after successes, re-trips on half-open failure", () => {
  let t = 0;
  const b = new CircuitBreaker("x", { failureThreshold: 3, openMs: 1000, successesToClose: 2 }, () => t);
  b.failure();
  b.failure();
  assert.equal(b.current, "closed");
  b.failure();
  assert.equal(b.current, "open");
  assert.equal(b.allow(), false);
  t = 999;
  assert.equal(b.current, "open");
  t = 1000;
  assert.equal(b.current, "half-open");
  assert.equal(b.allow(), true);
  b.success();
  assert.equal(b.current, "half-open");
  b.success();
  assert.equal(b.current, "closed");
  b.failure();
  b.failure();
  b.failure();
  t = 2000;
  assert.equal(b.current, "half-open");
  b.failure();
  assert.equal(b.current, "open");
});

test("metrics: counters, gauges, histogram buckets and Prometheus rendering", () => {
  const m = new Metrics();
  m.inc("a_total", { venue: "raydium" });
  m.inc("a_total", { venue: "raydium" }, 2);
  m.set("g", 5);
  m.observe("lat_ms", 120, { venue: "raydium" });
  m.observe("lat_ms", 3000, { venue: "raydium" });
  assert.equal(m.get("a_total", { venue: "raydium" }), 3);
  const text = m.render();
  assert.match(text, /a_total\{venue="raydium"\} 3/);
  assert.match(text, /g 5/);
  assert.match(text, /lat_ms_bucket\{venue="raydium",le="250"\} 1/);
  assert.match(text, /lat_ms_bucket\{venue="raydium",le="\+Inf"\} 2/);
  assert.match(text, /lat_ms_count\{venue="raydium"\} 2/);
});

test("health without a worker is down and not ready; quote failures trip the venue breaker; simulation breaker blocks readiness", async () => {
  const t = 0;
  const h = new RouterHealth(null, { now: () => t, breaker: { failureThreshold: 2, openMs: 100, successesToClose: 1 } });
  const down = await h.report();
  assert.equal(down.status, "down");
  assert.equal((await h.ready()).ready, false);
  h.recordQuote("raydium", false, 50);
  h.recordQuote("raydium", false, 50);
  const r = await h.report();
  assert.equal(r.venues.raydium.breaker, "open");
  assert.equal(r.venues.raydium.quoteFailures, 2);
  assert.equal(h.breaker("venue:raydium").allow(), false);
  h.recordSimulation(false);
  h.recordSimulation(false);
  assert.match((await h.ready()).reason, /not started|simulation/);
  assert.equal(r.executionEnabled, false);
});
