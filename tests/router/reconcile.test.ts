/** Task 18: reconciliation from FIXTURE transaction meta; lifecycle transitions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ExecutionTracker, reconcileExecution, type ConfirmedTransaction } from "@henar/tx-builder";
import { NOW, OWNER, TREASURY, singleBuyPlan, splitSellPlan } from "./fixtures/plan";

function confirmed(plan: ReturnType<typeof singleBuyPlan>, userOut: bigint, over: Partial<ConfirmedTransaction> = {}): ConfirmedTransaction {
  const inAta = plan.requiredAtas.find((a) => a.purpose === "user-input")!;
  const outAta = plan.requiredAtas.find((a) => a.purpose === "user-output")!;
  const feeAta = plan.requiredAtas.find((a) => a.purpose === "henar-fee")!;
  return {
    signature: "sig",
    slot: 300_000_020,
    err: null,
    feeLamports: 5000,
    tokenBalances: [
      { account: inAta.address, mint: inAta.mint, owner: OWNER, before: "500000000", after: (500_000_000n - BigInt(plan.totals.amountIn)).toString() },
      { account: outAta.address, mint: outAta.mint, owner: OWNER, before: "7", after: (7n + userOut).toString() },
      { account: feeAta.address, mint: feeAta.mint, owner: TREASURY, before: "0", after: plan.henarFee.amount },
    ],
    ...over,
  };
}

const base = (plan: ReturnType<typeof singleBuyPlan>, fetch: (s: string) => Promise<ConfirmedTransaction | null>, heights = { current: 100, last: 200 }) => ({
  plan,
  signature: "sig",
  lastValidBlockHeight: heights.last,
  currentBlockHeight: heights.current,
  fetch,
  now: NOW,
});

test("confirmed buy: amounts, fee and network fee from chain meta; onchain=true", async () => {
  const plan = singleBuyPlan();
  const r = await reconcileExecution(base(plan, async () => confirmed(plan, BigInt(plan.totals.expectedAmountOut))));
  assert.equal(r.status, "CONFIRMED");
  assert.equal(r.onchain, true);
  assert.equal(r.slot, 300_000_020);
  assert.equal(r.amountIn, plan.totals.amountIn);
  assert.equal(r.amountOut, plan.totals.expectedAmountOut);
  assert.equal(r.henarFee, plan.henarFee.amount);
  assert.equal(r.networkFeeLamports, "5000");
  assert.deepEqual(r.route, [{ venue: "raydium", poolAddress: plan.legs[0].poolAddress }]);
});

test("confirmed but below floor is FAILED; program error is FAILED with the error; missing balances are UNKNOWN", async () => {
  const plan = singleBuyPlan();
  const low = await reconcileExecution(base(plan, async () => confirmed(plan, BigInt(plan.totals.minimumAmountOut) - 1n)));
  assert.equal(low.status, "FAILED");
  assert.match(low.failureReason ?? "", /below plan floor/);
  const err = await reconcileExecution(base(plan, async () => confirmed(plan, 0n, { err: { InstructionError: [3, "Custom"] } })));
  assert.equal(err.status, "FAILED");
  assert.match(err.failureReason ?? "", /InstructionError/);
  const blind = await reconcileExecution(base(plan, async () => ({ ...confirmed(plan, 1n), tokenBalances: [] })));
  assert.equal(blind.status, "UNKNOWN");
  assert.equal(blind.onchain, true);
});

test("not found: SUBMITTED while the blockhash is valid, EXPIRED after; fetch failure is UNKNOWN and not onchain", async () => {
  const plan = singleBuyPlan();
  const pending = await reconcileExecution(base(plan, async () => null, { current: 150, last: 200 }));
  assert.equal(pending.status, "SUBMITTED");
  assert.equal(pending.onchain, false);
  const expired = await reconcileExecution(base(plan, async () => null, { current: 201, last: 200 }));
  assert.equal(expired.status, "EXPIRED");
  const broken = await reconcileExecution(base(plan, async () => { throw new Error("rpc down"); }));
  assert.equal(broken.status, "UNKNOWN");
  assert.equal(broken.onchain, false);
});

test("sell split: net USDC delta compared with the net floor; route lists both legs", async () => {
  const plan = splitSellPlan();
  const net = BigInt(plan.totals.minimumNetUserOutput);
  const r = await reconcileExecution(base(plan, async () => confirmed(plan, net)));
  assert.equal(r.status, "CONFIRMED");
  assert.equal(r.route.length, 2);
  const low = await reconcileExecution(base(plan, async () => confirmed(plan, net - 1n)));
  assert.equal(low.status, "FAILED");
});

test("lifecycle tracker: forward transitions only, early failure/expiry allowed, terminal states are final", () => {
  const t = new ExecutionTracker("p", () => NOW);
  t.transition("BUILT").transition("SIGNED").transition("SUBMITTED").transition("CONFIRMED");
  assert.equal(t.status, "CONFIRMED");
  assert.deepEqual(t.history.map((h) => h.status), ["QUOTED", "BUILT", "SIGNED", "SUBMITTED", "CONFIRMED"]);
  assert.throws(() => t.transition("FAILED"), /terminal/);
  const early = new ExecutionTracker("q");
  early.transition("BUILT").transition("FAILED", "simulation refused");
  assert.equal(early.status, "FAILED");
  const skip = new ExecutionTracker("r");
  assert.throws(() => skip.transition("SUBMITTED"), /illegal transition/);
  assert.throws(() => new ExecutionTracker("s").transition("CONFIRMED"), /illegal transition/);
  const unknown = new ExecutionTracker("u");
  unknown.transition("BUILT").transition("SIGNED").transition("SUBMITTED").transition("UNKNOWN");
  assert.equal(unknown.status, "UNKNOWN");
});
