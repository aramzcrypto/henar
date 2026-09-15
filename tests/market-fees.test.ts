import { test } from "node:test";
import assert from "node:assert/strict";
import { marketAmounts, buildSchema } from "../src/lib/market";
import { grossForNet, MARKET_FEE_BPS, tradeFee } from "../src/lib/trade-fee";

/* Expected amounts are derived from the fee constant rather than written out,
   so a change in policy shows up as a policy change and not as a wall of
   arithmetic to re-do by hand. */
const FEE = BigInt(MARKET_FEE_BPS);

test("input fees preserve the total budget and output minimum", () => {
  const input = 10_000_000n;
  const fee = tradeFee(input);
  assert.deepEqual(marketAmounts(input, 200000n, 199000n, true), {
    fee,
    swapInput: input - fee,
    receive: 200000n,
    minReceive: 199000n,
  });
  // The user's total outlay is unchanged by where the fee is taken.
  assert.equal(fee + (input - fee), input);
});
test("output fees are fixed before signature and deducted from the received minimum", () => {
  const received = 200000n;
  const outputFee = tradeFee(received);
  assert.deepEqual(marketAmounts(10_000_000n, received, 199000n, false), {
    fee: outputFee,
    swapInput: 10_000_000n,
    receive: received - outputFee,
    minReceive: 199000n - outputFee,
  });
  assert.throws(() => marketAmounts(1n, 100000n, 1n, false));
});
test("the shared fee can be reversed exactly for an input budget", () => {
  const net = 10000000n;
  const gross = grossForNet(net);
  assert.equal(MARKET_FEE_BPS, 10);
  assert.equal(FEE, 10n);
  assert.equal(marketAmounts(gross, 200000n, 199000n, true).swapInput, net);
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
