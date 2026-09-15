/** Tasks 14 + 15: transaction assembly on FIXTURE plans with a FIXTURE blockhash. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { BuildOptions, PlannedLeg } from "@henar/router-core";
import { buildTransaction, fixtureBlockhashProvider, type LegInstructionBuilder } from "@henar/tx-builder";
import { NOW, OWNER, key, singleBuyPlan, splitSellPlan } from "./fixtures/plan";

const seen: { leg: PlannedLeg; options: BuildOptions }[] = [];
const fakeLegBuilder: LegInstructionBuilder = async (leg, options) => {
  seen.push({ leg, options });
  const ix = new TransactionInstruction({
    programId: new PublicKey(leg.programId),
    keys: [{ pubkey: new PublicKey(OWNER), isSigner: true, isWritable: true }, { pubkey: new PublicKey(leg.poolAddress), isSigner: false, isWritable: true }],
    data: Buffer.from(`min:${options.minimumAmountOut}`),
  });
  return { instructions: [ix], lookupTables: [], reason: null, detail: "fixture" };
};
const opts = { executionEnabled: true, blockhash: fixtureBlockhashProvider(), legBuilder: fakeLegBuilder, now: NOW };

test("execution flag off → EXECUTION_DISABLED and no leg builder call", async () => {
  delete process.env.HENAR_ROUTER_EXECUTION;
  seen.length = 0;
  const r = await buildTransaction(singleBuyPlan(), { ...opts, executionEnabled: undefined });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "EXECUTION_DISABLED");
  assert.equal(seen.length, 0);
});

test("buy: compute budget, idempotent ATAs, input-side fee transfer, then the venue leg; every leg gets the plan floor", async () => {
  seen.length = 0;
  const plan = singleBuyPlan();
  const r = await buildTransaction(plan, opts);
  assert.equal(r.ok, true, !r.ok ? r.detail : "");
  if (!r.ok) return;
  const msg = r.built.transaction.message;
  const programs = msg.compiledInstructions.map((ix) => msg.staticAccountKeys[ix.programIdIndex].toBase58());
  assert.equal(programs[0], ComputeBudgetProgram.programId.toBase58());
  assert.equal(programs[1], ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()); // user-output ATA (Token-2022)
  assert.equal(programs[2], ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()); // fee ATA
  assert.equal(programs[3], TOKEN_PROGRAM_ID.toBase58()); // fee transfer on USDC input
  assert.equal(programs[4], "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
  assert.equal(r.built.blockhashSource, "fixture");
  assert.equal(r.built.blockhash, "11111111111111111111111111111111");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.minimumAmountOut, plan.legs[0].minimumAmountOut);
  assert.equal(seen[0].options.owner, OWNER);
  assert.deepEqual(r.built.legFloors, [{ index: 0, venue: "raydium", minimumAmountOut: plan.legs[0].minimumAmountOut }]);
  // The fee instruction is a TransferChecked with the plan amount and decimals.
  const feeIx = msg.compiledInstructions[3];
  assert.equal(feeIx.data[0], 12); // TransferChecked discriminator
  assert.equal(Buffer.from(feeIx.data).readBigUInt64LE(1), 150_000n);
  assert.equal(feeIx.data[9], 6);
  // The venue leg carries the floor it was handed.
  assert.equal(Buffer.from(msg.compiledInstructions[4].data).toString(), `min:${plan.legs[0].minimumAmountOut}`);
  assert.equal(msg.staticAccountKeys[0].toBase58(), OWNER); // payer
});

test("sell split: legs in plan order with their own floors, Token-2022 fee program, fee transfer after the swaps", async () => {
  seen.length = 0;
  const plan = splitSellPlan();
  const r = await buildTransaction(plan, opts);
  assert.equal(r.ok, true, !r.ok ? r.detail : "");
  if (!r.ok) return;
  assert.deepEqual(seen.map((s) => [s.leg.venue, s.options.minimumAmountOut]), plan.legs.map((l) => [l.venue, l.minimumAmountOut]));
  const msg = r.built.transaction.message;
  const programs = msg.compiledInstructions.map((ix) => msg.staticAccountKeys[ix.programIdIndex].toBase58());
  const last = programs[programs.length - 1];
  assert.equal(last, TOKEN_PROGRAM_ID.toBase58()); // fee on USDC output, last
  assert.ok(programs.includes("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"));
  assert.equal(plan.henarFee.tokenProgram, TOKEN_PROGRAM_ID.toBase58());
  assert.ok(plan.requiredAtas.some((a) => a.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58()));
});

test("builder refuses: expired plan, tampered floors, adapter refusal, foreign signer", async () => {
  const plan = singleBuyPlan();
  const expired = await buildTransaction(plan, { ...opts, now: NOW + 60_000 });
  assert.equal(!expired.ok && expired.reason, "QUOTE_EXPIRED");
  const tampered = await buildTransaction({ ...plan, legs: [{ ...plan.legs[0], minimumAmountOut: "0" }] }, opts);
  assert.equal(!tampered.ok && tampered.reason, "INVALID_REQUEST");
  const refused = await buildTransaction(plan, { ...opts, legBuilder: async () => ({ instructions: [], lookupTables: [], reason: "VENUE_DISABLED", detail: "off" }) });
  assert.equal(!refused.ok && refused.reason, "VENUE_DISABLED");
  const foreign = await buildTransaction(plan, {
    ...opts,
    legBuilder: async (leg) => ({ instructions: [new TransactionInstruction({ programId: new PublicKey(leg.programId), keys: [{ pubkey: new PublicKey(key(66)), isSigner: true, isWritable: false }], data: Buffer.alloc(0) })], lookupTables: [], reason: null, detail: null }),
  });
  assert.equal(!foreign.ok && foreign.reason, "INVALID_REQUEST");
  assert.match(!foreign.ok ? foreign.detail : "", /requires signer/);
});

test("lookup tables are resolved through the provider and applied to the v0 message", async () => {
  const plan = { ...singleBuyPlan(), lookupTables: { required: true, addresses: [key(88)] } };
  const { AddressLookupTableAccount } = await import("@solana/web3.js");
  const table = new AddressLookupTableAccount({ key: new PublicKey(key(88)), state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: [new PublicKey(key(1))] } });
  const r = await buildTransaction(plan, { ...opts, lookupTables: { resolve: async () => [table] } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.built.lookupTables, [key(88)]);
  assert.equal(r.built.transaction.message.addressTableLookups.length, 1);
});
