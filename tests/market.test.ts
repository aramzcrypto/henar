import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/market/route";
import { stocks } from "../src/lib/registry";
import { quoteRequest } from "./helpers/quote-request";
const request = (mint: string, amount = "10") => quoteRequest({ mint, amount });
test("market rejects malformed mints before calling any external service", async () => {
  const res = await POST(request("NVDA"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /public key/i);
});
test("market rejects zero and precision overflow before calling external services", async () => {
  for (const value of ["0", "0.0000001", "-1"]) {
    const res = await POST(request(stocks[0].mint, value));
    assert.equal(res.status, 400);
  }
});
test("market fails closed when credentials are unavailable", async () => {
  const previous = process.env.JUPITER_API_KEY;
  delete process.env.JUPITER_API_KEY;
  try {
    const res = await POST(request(stocks[0].mint));
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not configured/);
  } finally {
    if (previous) process.env.JUPITER_API_KEY = previous;
  }
});
