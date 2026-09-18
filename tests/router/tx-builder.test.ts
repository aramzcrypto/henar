/** Tasks 14 + 15: transaction assembly on FIXTURE plans with a FIXTURE blockhash. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { BuildOptions, PlannedLeg } from "@henar/router-core";
import { buildTransaction, fixtureBlockhashProvider, type LegInstructionBuilder } from "@henar/tx-builder";
import { NOW, OWNER, key, singleBuyPlan, splitSellPlan } from "./fixtures/plan";
import { tradeFee } from "@/lib/trade-fee";

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
  assert.equal(Buffer.from(feeIx.data).readBigUInt64LE(1), tradeFee(100_000_000n));
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

/* --- Transaction size is a hard constraint -------------------------------
 * A route can quote well, build cleanly and still be unsendable: a Solana
 * packet is 1232 bytes, and three legs of concentrated liquidity carry a lot
 * of tick arrays. The builder used to compile the message and return it
 * without ever serializing, so an oversized route reached the user and failed
 * on submission. It must refuse instead, and say how big it was.
 */
test("a route that exceeds the packet limit is refused with its measured size", async () => {
  /* Pad one leg with enough distinct accounts to overrun 1232 bytes. Each
     account key is 32 bytes in a message with no lookup table. */
  const fat: LegInstructionBuilder = async (leg) => ({
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(leg.programId),
        keys: Array.from({ length: 40 }, (_, i) => ({ pubkey: new PublicKey(key(100 + i)), isSigner: false, isWritable: true })),
        data: Buffer.alloc(320),
      }),
    ],
    lookupTables: [],
    reason: null,
    detail: "fixture",
  });
  const r = await buildTransaction(splitSellPlan(), { ...opts, legBuilder: fat });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "TRANSACTION_TOO_LARGE");
  /* Either path is a correct refusal: an oversized message may fail inside
     serialization or measure over the limit. What matters is that it is
     refused as TRANSACTION_TOO_LARGE and says why. */
  assert.match(!r.ok ? (r.detail ?? "") : "", /byte|serialize|overrun/);
});

test("a normal route reports the size it actually serialized to", async () => {
  const r = await buildTransaction(singleBuyPlan(), opts);
  assert.equal(r.ok, true, !r.ok ? r.detail : "");
  if (!r.ok) return;
  assert.ok(r.built.serializedBytes > 0);
  assert.ok(r.built.serializedBytes <= 1232, `expected a sendable transaction, got ${r.built.serializedBytes} bytes`);
  // The measurement is the serialization, not an estimate derived from it.
  assert.equal(r.built.serializedBytes, r.built.transaction.serialize().length);
});

test("lookup tables offered by a leg are collected and passed to compilation", async () => {
  const table = key(77);
  const withTable: LegInstructionBuilder = async (leg, options) => {
    const base = await fakeLegBuilder(leg, options);
    return { ...base, lookupTables: [new PublicKey(table)] };
  };
  const asked: string[] = [];
  const r = await buildTransaction(singleBuyPlan(), {
    ...opts,
    legBuilder: withTable,
    /* Returning none keeps the fixture offline; what is asserted is that the
       builder asked for the venue's table at all, which it previously did
       not — every route compiled with no tables and the large ones overran. */
    lookupTables: { resolve: async (addresses) => { asked.push(...addresses); return []; } },
  });
  assert.equal(r.ok, true, !r.ok ? r.detail : "");
  assert.ok(asked.includes(table), `expected the venue's lookup table to be resolved, asked for ${JSON.stringify(asked)}`);
});
