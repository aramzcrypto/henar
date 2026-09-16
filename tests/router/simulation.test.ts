/** Task 16: simulation normalization on RECORDED-SHAPE FIXTURE responses. The RPC simulator itself is LIVE_VALIDATION_PENDING. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_MINT } from "@henar/router-core";
import { normalizeSimulation, type RawSimulation } from "@henar/tx-builder";
import { NOW, OWNER, TREASURY, rep, singleBuyPlan, splitSellPlan } from "./fixtures/plan";

function raw(plan: ReturnType<typeof singleBuyPlan>, userOutDelta: bigint, overrides: Partial<RawSimulation> = {}): RawSimulation {
  const inAta = plan.requiredAtas.find((a) => a.purpose === "user-input")!;
  const outAta = plan.requiredAtas.find((a) => a.purpose === "user-output")!;
  const feeAta = plan.requiredAtas.find((a) => a.purpose === "henar-fee")!;
  return {
    err: null,
    logs: ["Program log: fixture"],
    unitsConsumed: 123_456,
    slot: 300_000_010,
    tokenBalances: [
      { account: inAta.address, mint: inAta.mint, owner: OWNER, before: "500000000", after: (500_000_000n - BigInt(plan.totals.amountIn)).toString() },
      { account: outAta.address, mint: outAta.mint, owner: OWNER, before: "0", after: userOutDelta.toString() },
      { account: feeAta.address, mint: feeAta.mint, owner: TREASURY, before: "10", after: (10n + BigInt(plan.henarFee.amount)).toString() },
    ],
    live: false,
    ...overrides,
  };
}

test("successful buy simulation at expected output: ok, deltas, within plan, never live from a fixture", () => {
  const plan = singleBuyPlan();
  const r = normalizeSimulation(raw(plan, BigInt(plan.totals.expectedAmountOut)), plan, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.computeUnitsConsumed, 123_456);
  assert.equal(r.simulatedOutput, plan.totals.expectedAmountOut);
  assert.equal(r.minimumOutput, plan.totals.minimumAmountOut);
  assert.equal(r.outputWithinPlan, true);
  assert.equal(r.slot, 300_000_010);
  assert.equal(r.live, false);
  assert.equal(r.tokenDeltas.find((d) => d.mint === USDC_MINT && d.owner === OWNER)!.delta, `-${plan.totals.amountIn}`);
  assert.equal(r.tokenDeltas.find((d) => d.owner === TREASURY)!.delta, plan.henarFee.amount);
  assert.equal(r.accountsChanged.length, 3);
});

test("output at exactly the floor passes; one unit below the floor fails even with no program error", () => {
  const plan = singleBuyPlan();
  const floor = BigInt(plan.totals.minimumAmountOut);
  assert.equal(normalizeSimulation(raw(plan, floor), plan, NOW).ok, true);
  const below = normalizeSimulation(raw(plan, floor - 1n), plan, NOW);
  assert.equal(below.ok, false);
  assert.equal(below.outputWithinPlan, false);
  assert.match(below.error ?? "", /below plan floor/);
});

test("program error is reported verbatim; missing output balance leaves outputWithinPlan unknown", () => {
  const plan = singleBuyPlan();
  const failed = normalizeSimulation(raw(plan, 0n, { err: { InstructionError: [4, { Custom: 6001 }] } }), plan, NOW);
  assert.equal(failed.ok, false);
  assert.match(failed.error ?? "", /6001/);
  const noOut = normalizeSimulation({ ...raw(plan, 0n), tokenBalances: [] }, plan, NOW);
  assert.equal(noOut.outputWithinPlan, null);
  assert.equal(noOut.simulatedOutput, null);
  assert.equal(noOut.ok, true); // no error observed, but nothing verified either — callers must check outputWithinPlan
});

test("sell: the user's USDC delta is compared with the net floor (after the Henar output fee)", () => {
  const plan = splitSellPlan();
  const netFloor = BigInt(plan.totals.minimumNetUserOutput);
  const ok = normalizeSimulation(raw(plan, netFloor), plan, NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.minimumOutput, plan.totals.minimumNetUserOutput);
  assert.equal(normalizeSimulation(raw(plan, netFloor - 1n), plan, NOW).ok, false);
  assert.equal(rep.mint, plan.legs[0].inputMint);
});

/**
 * Regression: an unreported post state is unknown, not zero.
 *
 * `simulateTransaction` does not always return every requested account. The
 * simulator decoded a missing post state as "0", making the delta minus the
 * entire prior balance: a whale's sell simulated as -387 USDC and was
 * reported as a route losing the user their money. Unknown must read as
 * unverified, never as a shortfall.
 */
test("a missing post state is reported as unverified, not as a catastrophic shortfall", () => {
  const plan = singleBuyPlan();
  const destination = plan.requiredAtas.find((a) => a.purpose === "user-output")!;
  const unreported = normalizeSimulation(
    {
      err: null,
      logs: [],
      unitsConsumed: 1000,
      slot: 1,
      tokenBalances: [
        { account: destination.address, mint: destination.mint, owner: destination.owner, before: "387619060", after: null },
      ],
      live: true,
    },
    plan,
    NOW,
  );
  assert.equal(unreported.ok, false);
  assert.match(unreported.error!, /did not return the post state/);
  assert.doesNotMatch(unreported.error!, /below plan floor/);
  assert.equal(unreported.simulatedOutput, null);
  assert.equal(unreported.outputAccount?.delta, null);
  assert.equal(unreported.outputAccount?.before, "387619060");

  // The output is read from the plan's designated account, by address.
  const expected = BigInt(plan.totals.expectedAmountOut);
  const reported = normalizeSimulation(
    {
      err: null,
      logs: [],
      unitsConsumed: 1000,
      slot: 1,
      tokenBalances: [
        // A decoy of the same mint and owner, listed first.
        { account: "DecoyAccount1111111111111111111111111111111", mint: destination.mint, owner: destination.owner, before: "0", after: "1" },
        { account: destination.address, mint: destination.mint, owner: destination.owner, before: "0", after: expected.toString() },
      ],
      live: true,
    },
    plan,
    NOW,
  );
  assert.equal(reported.ok, true);
  assert.equal(reported.outputAccount?.address, destination.address);
  assert.equal(reported.simulatedOutput, expected.toString());
});

/**
 * The production build path runs this gate before a transaction is returned
 * to a wallet. It passes only on a clean simulation that verified the output;
 * an error, a shortfall, or an unreported post state all refuse.
 */
test("gateSimulation: passes only when the simulation verified the output at or above the floor", async () => {
  const { gateSimulation } = await import("@henar/router-app");
  const { VersionedTransaction, TransactionMessage, PublicKey } = await import("@solana/web3.js");
  const plan = singleBuyPlan();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(OWNER), recentBlockhash: "11111111111111111111111111111111", instructions: [] }).compileToV0Message());
  const withRaw = (r: RawSimulation) => ({ simulate: async () => r });
  const pass = await gateSimulation(withRaw(raw(plan, BigInt(plan.totals.expectedAmountOut))), tx, plan, NOW);
  assert.equal(pass.ok, true);
  assert.equal(pass.simulation?.outputWithinPlan, true);
  const short = await gateSimulation(withRaw(raw(plan, BigInt(plan.totals.minimumAmountOut) - 1n)), tx, plan, NOW);
  assert.equal(short.ok, false);
  assert.match(short.error!, /below plan floor/);
  const errored = await gateSimulation(withRaw(raw(plan, 0n, { err: { InstructionError: [2, "Custom"] } })), tx, plan, NOW);
  assert.equal(errored.ok, false);
  const unverified = await gateSimulation(withRaw({ ...raw(plan, 0n), tokenBalances: [] }), tx, plan, NOW);
  assert.equal(unverified.ok, false);
  assert.match(unverified.error!, /did not verify/);
  const threw = await gateSimulation({ simulate: async () => { throw new Error("rpc down"); } }, tx, plan, NOW);
  assert.equal(threw.ok, false);
  assert.match(threw.error!, /rpc down/);
});
