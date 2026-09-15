/** The limiter exists so a 200-observation run survives a 429. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, retryAfterMs } from "../../scripts/router/rate-limit";
import { RateLimitError } from "@/lib/execution/shared";

test("calls are serialised and spaced by at least the interval", async () => {
  const limit = createLimiter({ minIntervalMs: 25 });
  const at: number[] = [];
  await Promise.all(
    [1, 2, 3, 4].map(() =>
      limit(async () => {
        at.push(Date.now());
      }),
    ),
  );
  assert.equal(at.length, 4);
  for (let i = 1; i < at.length; i += 1)
    assert.ok(at[i]! - at[i - 1]! >= 20, `gap ${at[i]! - at[i - 1]!}ms too short`);
});

test("a rate limit is retried, not surfaced as a failure", async () => {
  const limit = createLimiter({ minIntervalMs: 1, retries: 3 });
  let attempts = 0;
  const value = await limit(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("429 Too Many Requests");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("a non-rate-limit error is not retried", async () => {
  const limit = createLimiter({ minIntervalMs: 1, retries: 5 });
  let attempts = 0;
  await assert.rejects(
    limit(async () => {
      attempts += 1;
      throw new Error("pool undecodable");
    }),
    /undecodable/,
  );
  assert.equal(attempts, 1, "a decode failure must fail fast");
});

test("persistent rate limiting eventually throws so the caller can record it", async () => {
  const limit = createLimiter({ minIntervalMs: 1, retries: 2 });
  await assert.rejects(
    limit(async () => {
      throw new Error("429");
    }),
    /429/,
  );
});

test("one failure does not poison the queue", async () => {
  const limit = createLimiter({ minIntervalMs: 1, retries: 0 });
  await assert.rejects(limit(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await limit(async () => "still working"), "still working");
});

test("Retry-After is read as seconds or as a date", () => {
  assert.equal(retryAfterMs("2"), 2_000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("not-a-date"), null);
  const soon = new Date(Date.now() + 5_000).toUTCString();
  const parsed = retryAfterMs(soon);
  assert.ok(parsed !== null && parsed > 3_000 && parsed <= 5_000, `got ${parsed}`);
});

/**
 * The server's own wait wins over ours.
 *
 * Backing off for less than Retry-After asks is how a caller earns a longer
 * ban, so an error carrying the header's value sets the floor for the wait.
 */
test("a rate limit carrying Retry-After is waited out for at least that long", async () => {
  const limit = createLimiter({ minIntervalMs: 1, retries: 2 });
  let attempts = 0;
  const started = Date.now();
  const waits: number[] = [];
  const value = await createLimiter({
    minIntervalMs: 1,
    retries: 2,
    onBackoff: (waitMs) => waits.push(waitMs),
  })(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new RateLimitError("Jupiter rate limit (429).", 120);
      throw error;
    }
    return "quoted";
  });
  assert.equal(value, "quoted");
  assert.equal(attempts, 2);
  assert.equal(waits[0], 120);
  assert.ok(Date.now() - started >= 120);
  // A rate limit with no header still retries on our own interval.
  assert.equal(await limit(async () => "ok"), "ok");
});

/**
 * Regression: a limiter must not deadlock against itself.
 *
 * With the queue installed under the RPC connection, a call site that also
 * wrapped its call queued behind the very call it was waiting for. The run
 * ended with no output and exit code 0, which reads as success.
 */
test("a nested call runs through instead of queuing behind itself", async () => {
  const limit = createLimiter({ minIntervalMs: 5 });
  const value = await limit(async () => limit(async () => "inner ran"));
  assert.equal(value, "inner ran");
});
