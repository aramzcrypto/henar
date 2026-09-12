import { test } from "node:test";
import assert from "node:assert/strict";
import { marketAmounts, buildSchema } from "../src/lib/market";
test("input fees preserve the total budget and output minimum", () => {
  assert.deepEqual(marketAmounts(10000000n, 200000n, 199000n, true), {
    fee: 25000n,
    swapInput: 9975000n,
    receive: 200000n,
    minReceive: 199000n,
  });
});
test("output fees are fixed before signature and deducted from the received minimum", () => {
  assert.deepEqual(marketAmounts(10000000n, 200000n, 199000n, false), {
    fee: 500n,
    swapInput: 10000000n,
    receive: 199500n,
    minReceive: 198500n,
  });
  assert.throws(() => marketAmounts(1n, 100000n, 1n, false));
});
test("Swap V2 responses can omit the legacy platformFee object", () => {
  const instruction = { programId: "test", accounts: [], data: "" };
  assert.ok(
    buildSchema.safeParse({
      inputMint: "test",
      outputMint: "test",
      inAmount: "1",
      outAmount: "1",
      otherAmountThreshold: "1",
      slippageBps: 50,
      priceImpactPct: "0",
      setupInstructions: [],
      swapInstruction: instruction,
      cleanupInstruction: null,
      otherInstructions: [],
      addressesByLookupTableAddress: {},
    }).success,
  );
});
