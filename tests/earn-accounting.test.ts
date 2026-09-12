import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyLedger,
  depositPrincipal,
  withdrawPrincipal,
  claimYield,
  settleYield,
  allocatePacks,
  packQuote,
  yieldProgress,
  type EarnPreferences,
} from "../src/lib/earn-accounting";
const packs: EarnPreferences = {
  destination: "packs",
  autoPacks: true,
  category: "AI",
};
const stockMode: EarnPreferences = { ...packs, destination: "stocks" };
const initial = () => depositPrincipal(emptyLedger(), 100_000_000n);
test("gross yield is split first, multiple net $10 thresholds create sealed entitlements without touching principal", () => {
  const { ledger, batch } = settleYield(initial(), 35_000_000n, 1000, packs);
  assert.equal(ledger.principal, 100_000_000n);
  assert.equal(ledger.protocolYield, 3_500_000n);
  assert.equal(ledger.claimableYield, 1_500_000n);
  assert.equal(ledger.allocatedYield, 30_000_000n);
  assert.deepEqual(batch, {
    firstId: 0n,
    count: 3n,
    category: "AI",
    source: "Earned",
    valuePerPack: 10_000_000n,
  });
  assert.equal(
    ledger.grossYield,
    ledger.protocolYield +
      ledger.claimableYield +
      ledger.allocatedYield +
      ledger.claimedYield,
  );
  assert.equal(settleYield(ledger, 35_000_000n, 1000, packs).batch, null);
});
test("one base unit under a threshold cannot create a pack", () => {
  const first = settleYield(initial(), 9_999_999n, 0, packs);
  assert.equal(first.batch, null);
  const exact = settleYield(first.ledger, 10_000_000n, 0, packs);
  assert.equal(exact.batch?.count, 1n);
  assert.equal(exact.ledger.claimableYield, 0n);
});
test("fee rounding carries across tiny accruals and cannot be avoided by frequent settlement", () => {
  let ledger = initial();
  for (let i = 1n; i <= 101n; i++)
    ledger = settleYield(ledger, i, 1000, stockMode).ledger;
  assert.deepEqual(ledger, settleYield(initial(), 101n, 1000, stockMode).ledger);
});
test("Stocks mode and disabled Auto Packs retain unspent yield; enabling consumes it once", () => {
  const ledger = settleYield(initial(), 30_000_000n, 1000, stockMode).ledger;
  assert.equal(ledger.claimableYield, 27_000_000n);
  assert.equal(
    allocatePacks(ledger, { ...packs, autoPacks: false }).batch,
    null,
  );
  const allocated = allocatePacks(ledger, packs);
  assert.equal(allocated.batch?.count, 2n);
  assert.equal(allocated.ledger.claimableYield, 7_000_000n);
  assert.equal(allocatePacks(allocated.ledger, packs).batch, null);
});
test("principal withdrawals and USDC yield claims are separate and reject overspending", () => {
  let ledger = settleYield(initial(), 10_000_000n, 1000, stockMode).ledger;
  ledger = withdrawPrincipal(ledger, 100_000_000n);
  assert.equal(ledger.claimableYield, 9_000_000n);
  ledger = claimYield(ledger, 9_000_000n);
  assert.equal(ledger.claimedYield, 9_000_000n);
  assert.throws(() => withdrawPrincipal(ledger, 1n));
  assert.throws(() => claimYield(ledger, 1n));
  assert.throws(() => depositPrincipal(ledger, -1n));
  assert.throws(() => settleYield(ledger, 0n, 1000, stockMode));
});
test("direct packs disclose exact 2% fee; earned packs invest all $10 without another fee", () => {
  assert.deepEqual(packQuote("Purchased", 200), {
    price: 10_000_000n,
    fee: 200_000n,
    stockValue: 9_800_000n,
  });
  assert.deepEqual(packQuote("Earned", 200), {
    price: 10_000_000n,
    fee: 0n,
    stockValue: 10_000_000n,
  });
  assert.throws(() => packQuote("Purchased", 10001));
});
test("large balances never pass through floating point and batches avoid one allocation per pack", () => {
  const gross = 90071992547409930000n;
  const result = settleYield(initial(), gross, 0, packs);
  assert.equal(
    result.ledger.allocatedYield + result.ledger.claimableYield,
    gross,
  );
  assert.equal(result.batch?.count, gross / 10_000_000n);
  assert.equal(yieldProgress(15_000_000n).basisPoints, 5000n);
});
test("category changes affect only future entitlements and principal deposits never advance pack progress", () => {
  const first = settleYield(initial(), 10_000_000n, 0, packs);
  const funded = depositPrincipal(first.ledger, 500_000_000n);
  assert.equal(allocatePacks(funded, packs).batch, null);
  const second = settleYield(funded, 21_000_000n, 0, {
    ...packs,
    category: "Space",
  });
  assert.equal(first.batch?.category, "AI");
  assert.equal(second.batch?.category, "Space");
  assert.equal(second.batch?.firstId, 1n);
  assert.equal(second.ledger.claimableYield, 1_000_000n);
  assert.equal(second.ledger.principal, 600_000_000n);
});
test("claiming USDC yield before enabling Packs cannot spend the same yield twice", () => {
  const accrued = settleYield(initial(), 40_000_000n, 1000, stockMode).ledger;
  const claimed = claimYield(accrued, 20_000_000n);
  const { ledger, batch } = allocatePacks(claimed, packs);
  assert.equal(batch?.count, 1n);
  assert.equal(ledger.claimableYield, 6_000_000n);
  assert.equal(
    ledger.grossYield,
    ledger.protocolYield +
      ledger.claimedYield +
      ledger.allocatedYield +
      ledger.claimableYield,
  );
});
