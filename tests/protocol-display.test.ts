import test from "node:test";
import assert from "node:assert/strict";
import {
  compactUsdc,
  exactDecimal,
  principalTvl,
} from "../src/lib/protocol/display";

test("Henar TVL sums only live protocol principal", () => {
  assert.equal(
    principalTvl([
      { principalBasis: { toString: () => "1100000" } },
      { principalBasis: { toString: () => "25000000" } },
    ]),
    "26.1",
  );
});

test("large USDC values are compact while retaining an exact hover value", () => {
  assert.equal(compactUsdc("17461410.294342"), "17.5M");
  assert.equal(exactDecimal("17461410.294342"), "17,461,410.294342");
  assert.equal(compactUsdc("0.000000"), "0");
});
