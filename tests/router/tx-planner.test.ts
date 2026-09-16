/** Tasks 13 + 15: planner output and minOut propagation, on FIXTURE quotes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT, buildPoolRegistry, intermediateRepresentationId, unavailableQuote, type QuoteRequest, type RankedQuote } from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardQuote } from "@henar/execution-guard";
import { assertPlanFloors, planExecution } from "@henar/tx-builder";
import { DEC, NOW, OWNER, SHARES, SLOT, TREASURY, approve, buy, key, pool, quoteFor, rep, representation, sell, singleBuyPlan, splitSellPlan } from "./fixtures/plan";
import { MARKET_FEE_BPS, tradeFee } from "@/lib/trade-fee";

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

/**
 * Path plans: two hops through a qualified intermediate. The planner must
 * accept the hop pairs, size the aggregate floor on the output-side legs
 * only, chain the first hop's floor into the second hop's input, and add the
 * intermediate's own account to the plan.
 */
{
  const registryOf = buildPoolRegistry;
  const SOL = "So11111111111111111111111111111111111111112";
  const SOL_FACTS = { mint: SOL, decimals: 9, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
  const solPool = pool("raydium", key(31), { representationId: intermediateRepresentationId(SOL), mint: SOL, baseMint: USDC_MINT, quoteMint: SOL, eligibility: "INTERMEDIATE_ROUTE", tvlUsd: 5_000_000 });
  const legPool = pool("raydium", key(32), { baseMint: SOL, quoteMint: rep.mint, eligibility: "ROUTING_LEG", tvlUsd: 2_000_000 });
  const pools = [solPool, legPool];
  const registry = registryOf(pools);
  const approvePath = (q: RankedQuote, hop: "intermediate" | "representation") => {
    const v = guardQuote(q, DEFAULT_EXECUTION_POLICY, { now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry, pathLeg: { intermediate: SOL, hop } });
    if (!v.approved) throw new Error(`path leg not approved: ${v.reason} ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
    return v;
  };
  /** A path leg quote: fee accounting mirrors the engine (fee on the USDC hop only). */
  const pathLeg = (request: QuoteRequest, amountIn: bigint, out: bigint, poolAddress: string, fee: { inputFee: bigint; outputFee: bigint }): RankedQuote => {
    const base = unavailableQuote("raydium", request, "SDK_ERROR", null, poolAddress, NOW);
    return {
      ...base,
      amountIn: amountIn.toString(), expectedAmountOut: out.toString(), unavailableReason: null, unavailableDetail: null, priceImpactBps: 10, slot: SLOT,
      onchainCheckedAtQuote: true, executionPath: "henar-native", expiresAt: new Date(NOW + 10_000).toISOString(), source: "raydium:fixture",
      fees: { inputMint: request.inputMint, outputMint: request.outputMint, userInput: (amountIn + fee.inputFee).toString(), henarInputFee: fee.inputFee.toString(), venueInput: amountIn.toString(), grossVenueOutput: out.toString(), venueFee: null, venueFeeMint: null, henarOutputFee: fee.outputFee.toString(), netUserOutput: (out - fee.outputFee).toString(), henarFeeBps: MARKET_FEE_BPS },
      henarFeeBps: MARKET_FEE_BPS,
      henarFeeAmount: (fee.inputFee > 0n ? fee.inputFee : fee.outputFee).toString(),
      henarFeeMint: USDC_MINT,
      swapInput: amountIn.toString(),
      netOutput: (out - fee.outputFee).toString(),
    };
  };

  test("buy path plan: USDC → SOL → representation, second hop fed the first hop's floor, intermediate ATA planned", () => {
    const userInput = 100_000_000n;
    const fee = (userInput * BigInt(MARKET_FEE_BPS)) / 10_000n;
    const venueInput = userInput - fee;
    const solOut = 500_000_000n; // 0.5 SOL
    const solFloor = solOut - (solOut * BigInt(DEFAULT_EXECUTION_POLICY.intermediateHopSlippageBps)) / 10_000n;
    const legA = approvePath(pathLeg({ ...buy(userInput.toString()), inputMint: USDC_MINT, outputMint: SOL }, venueInput, solOut, key(31), { inputFee: fee, outputFee: 0n }), "intermediate");
    assert.equal(legA.minimumAmountOut, solFloor.toString());
    const legB = approvePath(pathLeg({ ...buy(solFloor.toString()), inputMint: SOL, outputMint: rep.mint }, solFloor, SHARES(20n), key(32), { inputFee: 0n, outputFee: 0n }), "representation");
    const plan = planExecution({ representation, side: "buy", kind: "path", intermediate: SOL_FACTS, owner: OWNER, treasuryOwner: TREASURY, userInput, legs: [{ verdict: legA }, { verdict: legB }], policy: DEFAULT_EXECUTION_POLICY, registry, now: NOW });
    assert.equal(plan.kind, "path");
    assert.equal(plan.intermediate?.mint, SOL);
    assert.equal(plan.legs[0].inputMint, USDC_MINT);
    assert.equal(plan.legs[0].outputMint, SOL);
    assert.equal(plan.legs[1].inputMint, SOL);
    assert.equal(plan.legs[1].amountIn, solFloor.toString());
    assert.equal(plan.totals.expectedAmountOut, SHARES(20n).toString());
    assert.equal(plan.totals.minimumAmountOut, legB.minimumAmountOut);
    assert.equal(plan.totals.minimumNetUserOutput, legB.minimumAmountOut);
    assert.equal(plan.henarFee.amount, fee.toString());
    assert.equal(plan.henarFee.on, "input");
    assert.ok(plan.requiredAtas.some((a) => a.purpose === "intermediate" && a.mint === SOL));
    assert.equal(plan.requiredAtas.find((a) => a.purpose === "user-output")?.mint, rep.mint);
    assert.doesNotThrow(() => assertPlanFloors(plan));
  });

  test("a path that feeds the expected output forward instead of the floor is refused", () => {
    const userInput = 100_000_000n;
    const fee = (userInput * BigInt(MARKET_FEE_BPS)) / 10_000n;
    const solOut = 500_000_000n;
    const legA = approvePath(pathLeg({ ...buy(userInput.toString()), inputMint: USDC_MINT, outputMint: SOL }, userInput - fee, solOut, key(31), { inputFee: fee, outputFee: 0n }), "intermediate");
    const legB = approvePath(pathLeg({ ...buy(solOut.toString()), inputMint: SOL, outputMint: rep.mint }, solOut, SHARES(20n), key(32), { inputFee: 0n, outputFee: 0n }), "representation");
    assert.throws(() => planExecution({ representation, side: "buy", kind: "path", intermediate: SOL_FACTS, owner: OWNER, treasuryOwner: TREASURY, userInput, legs: [{ verdict: legA }, { verdict: legB }], policy: DEFAULT_EXECUTION_POLICY, registry, now: NOW }), /feeds .* forward but the first hop floor/);
    assert.throws(() => planExecution({ representation, side: "buy", kind: "path", owner: OWNER, treasuryOwner: TREASURY, userInput, legs: [{ verdict: legA }, { verdict: legB }], policy: DEFAULT_EXECUTION_POLICY, registry, now: NOW }), /intermediate/);
  });

  test("sell path plan: representation → SOL → USDC with the fee on the USDC output and the floor chained", () => {
    const userInput = SHARES(10n);
    const solOut = 900_000_000n;
    const legB = approvePath(pathLeg({ ...sell(userInput.toString()), inputMint: rep.mint, outputMint: SOL }, userInput, solOut, key(32), { inputFee: 0n, outputFee: 0n }), "representation");
    const solFloor = BigInt(legB.minimumAmountOut!);
    const usdcOut = 90_000_000n;
    const feeOut = (usdcOut * BigInt(MARKET_FEE_BPS)) / 10_000n;
    const legA = approvePath(pathLeg({ ...sell(solFloor.toString()), inputMint: SOL, outputMint: USDC_MINT }, solFloor, usdcOut, key(31), { inputFee: 0n, outputFee: feeOut }), "intermediate");
    const plan = planExecution({ representation, side: "sell", kind: "path", intermediate: SOL_FACTS, owner: OWNER, treasuryOwner: TREASURY, userInput, legs: [{ verdict: legB }, { verdict: legA }], policy: DEFAULT_EXECUTION_POLICY, registry, now: NOW });
    assert.equal(plan.legs[1].amountIn, solFloor.toString());
    assert.equal(plan.henarFee.on, "output");
    assert.equal(plan.henarFee.mint, USDC_MINT);
    assert.equal(plan.totals.minimumAmountOut, legA.minimumAmountOut);
    const min = BigInt(legA.minimumAmountOut!);
    assert.equal(plan.totals.minimumNetUserOutput, (min - (min * BigInt(MARKET_FEE_BPS)) / 10_000n).toString());
    assert.doesNotThrow(() => assertPlanFloors(plan));
  });
}
