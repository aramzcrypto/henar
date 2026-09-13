import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTransientRetry } from "../src/lib/http-retry";

test("retries transient quote responses and returns the recovered response", async () => {
  let calls = 0;
  const delays: number[] = [];
  const response = await fetchWithTransientRetry(
    async () => {
      calls += 1;
      return new Response(null, { status: calls < 3 ? 429 : 200 });
    },
    { sleep: async (delay) => void delays.push(delay) },
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [150, 400]);
});

test("does not retry a permanent quote response", async () => {
  let calls = 0;
  const response = await fetchWithTransientRetry(async () => {
    calls += 1;
    return new Response(null, { status: 400 });
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});
