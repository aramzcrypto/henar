import test from "node:test";
import assert from "node:assert/strict";
import { estimateInput } from "../src/lib/indicative-quote";
test("receive estimate retains base-unit precision beyond Number range", async () => {
  const desired = 90071992547409931n;
  const result = await estimateInput(desired, 1000000n, async (input) => ({
    inAmount: String(input),
    outAmount: String(input * 3n),
  }));
  assert.equal(BigInt(result.inAmount), (desired + 2n) / 3n);
  assert.ok(BigInt(result.outAmount) >= desired);
});
test("receive estimate rejects insufficient liquidity and nonconverging routes", async () => {
  await assert.rejects(
    estimateInput(1000n, 1n, async (input) => ({
      inAmount: String(input),
      outAmount: "0",
    })),
    /liquidity/,
  );
  await assert.rejects(
    estimateInput(1000n, 1n, async (input) => ({
      inAmount: String(input),
      outAmount: "10",
    })),
    /reliably/,
  );
});
