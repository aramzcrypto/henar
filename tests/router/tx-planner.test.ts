/** Tasks 13 + 15: planner output and minOut propagation, on FIXTURE quotes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT, buildPoolRegistry } from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY } from "@henar/execution-guard";
import { assertPlanFloors, planExecution } from "@henar/tx-builder";
import { DEC, NOW, OWNER, SHARES, TREASURY, approve, buy, key, pool, quoteFor, rep, representation, sell, singleBuyPlan, splitSellPlan } from "./fixtures/plan";
import { tradeFee } from "@/lib/trade-fee";

test("single-leg buy plan: fee on input, venue input = user input − fee, floor from the guard, ATAs and programs listed", () => {
  const plan = singleBuyPlan();
  assert.equal(plan.side, "buy");
  assert.equal(plan.provider, rep.provider);
  assert.equal(plan.legs.length, 1);
  assert.equal(plan.legs[0].amountIn, (100_000_000n - tradeFee(100_000_000n)).toString());
  assert.equal(plan.legs[0].percentBps, 10_000);
  assert.equal(plan.henarFee.on, "input");
  assert.equal(plan.henarFee.amount, tradeFee(100_000_000n).toString());
  assert.equal(plan.henarFee.mint, USDC_MINT);
  assert.equal(plan.henarFee.tokenProgram, TOKEN_PROGRAM_ID.toBase58());
  assert.equal(plan.henarFee.destination, getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(TREASURY), true).toBase58());
  assert.equal(plan.totals.amountIn, "100000000");
  assert.equal(plan.totals.expectedAmountOut, SHARES(20n).toString());
  // Floor = expected × (1 − 35 bps): 30 base + 10 impact × 0.5
  const expectedFloor = SHARES(20n) - (SHARES(20n) * 35n) / 10_000n;
  assert.equal(plan.totals.minimumAmountOut, expectedFloor.toString());
  assert.equal(plan.totals.minimumNetUserOutput, plan.totals.minimumAmountOut);
  assert.equal(plan.legs[0].minimumAmountOut, expectedFloor.toString());
  assert.equal(plan.slippageBps, 35);
  const purposes = plan.requiredAtas.map((a) => a.purpose).sort();
  assert.deepEqual(purposes, ["henar-fee", "user-input", "user-output"]);
  assert.equal(plan.requiredAtas.find((a) => a.purpose === "user-output")!.tokenProgram, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.ok(plan.requiredPrograms.includes("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"));
  assert.ok(plan.requiredPrograms.includes(TOKEN_2022_PROGRAM_ID.toBase58()));
  assert.equal(plan.lookupTables.required, false);
  assert.equal(plan.sourceSlots.raydium, 300_000_000);
  assert.equal(plan.expiresAt, new Date(NOW + 10_000).toISOString());
  assert.equal(plan.planId.length, 32);
  assert.doesNotThrow(() => assertPlanFloors(plan));
});

test("split sell plan: legs sum exactly, aggregate floor is the sum of leg floors, fee on output, net minimum after fee", () => {
  const plan = splitSellPlan();
  assert.equal(plan.legs.length, 2);
  assert.equal(plan.legs.reduce((s, l) => s + BigInt(l.amountIn), 0n), 1_000_000_000n);
  assert.deepEqual(plan.legs.map((l) => l.percentBps), [6_000, 4_000]);
  const floors = plan.legs.map((l) => BigInt(l.minimumAmountOut));
  assert.equal(BigInt(plan.totals.minimumAmountOut), floors[0] + floors[1]);
  assert.equal(plan.henarFee.on, "output");
  assert.equal(plan.henarFee.mint, USDC_MINT);
  const sumMin = floors[0] + floors[1];
  assert.equal(plan.totals.minimumNetUserOutput, (sumMin - tradeFee(sumMin)).toString());
  assert.equal(plan.henarFee.amount, tradeFee(50_000_000n).toString()); // fee on expected gross output
  assert.ok(plan.compute.estimatedUnits > 300_000);
  assert.equal(plan.accountCount, 12 + 24 + 26);
  assert.equal(plan.lookupTables.required, true);
  assert.doesNotThrow(() => assertPlanFloors(plan));
  const same = splitSellPlan();
  assert.equal(same.planId, plan.planId); // deterministic
});

test("Task 15: a leg without a positive floor cannot be planned, and a plan whose floors were tampered with is rejected", () => {
  const pools = [pool("raydium", key(1))];
  const verdict = approve(quoteFor("raydium", buy(), SHARES(20n), key(1)), pools);
  const base = { representation, side: "buy" as const, owner: OWNER, treasuryOwner: TREASURY, userInput: 100_000_000n, policy: DEFAULT_EXECUTION_POLICY, registry: buildPoolRegistry(pools), now: NOW };
  assert.throws(() => planExecution({ ...base, legs: [{ verdict, minimumAmountOut: 0n }] }), /no positive minimumAmountOut/);
  assert.throws(() => planExecution({ ...base, legs: [{ verdict: { ...verdict, minimumAmountOut: null } }] }), /no positive minimumAmountOut/);
  assert.throws(() => planExecution({ ...base, legs: [{ verdict, minimumAmountOut: SHARES(21n) }] }), /exceeds expected/);
  const refused = { ...verdict, approved: false, reason: "PRICE_IMPACT_TOO_HIGH" as const };
  assert.throws(() => planExecution({ ...base, legs: [{ verdict: refused }] }), /not guard-approved/);
  const plan = singleBuyPlan();
  assert.throws(() => assertPlanFloors({ ...plan, legs: [{ ...plan.legs[0], minimumAmountOut: "0" }] }), /is zero/);
  assert.throws(() => assertPlanFloors({ ...plan, totals: { ...plan.totals, minimumAmountOut: "1" } }), /not the sum/);
  assert.throws(() => assertPlanFloors({ ...plan, totals: { ...plan.totals, minimumNetUserOutput: "1" } }), /net minimum/);
});

test("planner refuses mismatched legs: wrong pair, different fee, unregistered pool, inputs that do not sum", () => {
  const pools = [pool("raydium", key(1))];
  const registry = buildPoolRegistry(pools);
  const verdict = approve(quoteFor("raydium", buy(), SHARES(20n), key(1)), pools);
  const base = { representation, side: "buy" as const, owner: OWNER, treasuryOwner: TREASURY, userInput: 100_000_000n, policy: DEFAULT_EXECUTION_POLICY, registry, now: NOW };
  assert.throws(() => planExecution({ ...base, legs: [{ verdict, amountIn: 1n }] }), /do not sum/);
  const half = approve(quoteFor("raydium", buy(), SHARES(20n), key(1)), pools);
  assert.throws(() => planExecution({ ...base, legs: [{ verdict, amountIn: 50_000_000n }, { verdict: { ...half, quote: { ...half.quote, henarFeeBps: 20 } }, amountIn: 49_850_000n }] }), /different Henar fee/);
  const unregistered = approve(quoteFor("raydium", buy(), SHARES(20n), key(1)), pools);
  assert.throws(() => planExecution({ ...base, registry: buildPoolRegistry([pool("raydium", key(9))]), legs: [{ verdict: unregistered }] }), /not a registered/);
  assert.throws(() => planExecution({ ...base, legs: [] }), /at least one leg/);
  assert.throws(() => planExecution({ ...base, representation: { ...representation, mint: key(77) }, legs: [{ verdict }] }), /USDC/);
  // Sell plan with a leg whose quote is a buy quote: pair still matches but fee side disagrees — caught by fee accounting
  const sellVerdict = approve(quoteFor("raydium", sell(), 50_000_000n, key(1)), pools);
  assert.throws(() => planExecution({ ...base, side: "sell", legs: [{ verdict: sellVerdict }] }), /do not sum/);
  void DEC;
});
