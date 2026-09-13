import { test } from "node:test";
import assert from "node:assert/strict";
import { installmentBudget } from "../services/solver/position-swap";
import { integer } from "../src/lib/protocol/client";
const base = {
  principalBasis: integer(20000000),
  investedFeeBasis: integer(0),
  claimable: integer(0),
  feeCarry: 0,
  yieldShareBps: 1000,
  tradeFeeBps: 25,
  stepsRemaining: 2,
};
test("position budget splits principal and net yield in base units", () => {
  assert.deepEqual(installmentBudget(base, 20000000n), {
    budget: 9975000n,
    remaining: 10000000n,
    fee: 25000n,
  });
  assert.deepEqual(installmentBudget(base, 22000000n), {
    budget: 10872750n,
    remaining: 10000000n,
    fee: 27250n,
  });
});
test("position budget excludes recovered protocol fee basis and reflects loss", () => {
  assert.deepEqual(
    installmentBudget(
      { ...base, investedFeeBasis: integer(2000000) },
      22000000n,
    ),
    installmentBudget(base, 20000000n),
  );
  assert.deepEqual(installmentBudget(base, 18000000n), {
    budget: 8977500n,
    remaining: 9000000n,
    fee: 22500n,
  });
  assert.deepEqual(
    installmentBudget({ ...base, stepsRemaining: 0 }, 20000000n),
    { budget: 0n, remaining: 0n, fee: 0n },
  );
});
