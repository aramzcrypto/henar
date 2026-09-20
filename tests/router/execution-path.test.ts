/**
 * Execution path pieces added for live testing: on-chain verification
 * classification (pure), Raydium native build refusals (no RPC), the
 * client-side router transaction validator on a FIXTURE-built transaction,
 * and the stateless quoteAndBuild refusals.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { USDC_MINT, applyVerification, classifyPoolVerification, unavailableQuote, type QuoteRequest } from "@henar/router-core";
import { RaydiumAdapter } from "@henar/venue-raydium";
import { buildTransaction, fixtureBlockhashProvider } from "@henar/tx-builder";
import { RouterApi, RouterHealth } from "@henar/router-app";
import { validateRouterTransaction } from "@/lib/router-transaction";
import { NOW, OWNER, SHARES, key, pool, rep, singleBuyPlan } from "./fixtures/plan";

function mintAccount(owner: PublicKey, decimals: number) {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  return { owner, data, executable: false, lamports: 1, rentEpoch: 0 };
}
/**
 * A pool account whose own bytes name a pair, at the layout offsets for its
 * type. An empty buffer is not a valid stand-in: verification reads the pair
 * out of the account, and a fixture that cannot hold one would let the pair
 * check pass by never running.
 */
const CLMM_MINT_OFFSETS = { base: 73, quote: 105 };
function poolAccountFor(owner: PublicKey, baseMint: string, quoteMint: string, bytes = 1544) {
  const data = Buffer.alloc(bytes);
  new PublicKey(baseMint).toBuffer().copy(data, CLMM_MINT_OFFSETS.base);
  new PublicKey(quoteMint).toBuffer().copy(data, CLMM_MINT_OFFSETS.quote);
  return { owner, data, executable: false, lamports: 1, rentEpoch: 0 };
}

test("on-chain verification: ONCHAIN_VERIFIED only when owner and both mints agree; failures disable the pool and keep the timestamp null", () => {
  const p = pool("raydium", key(1), { programId: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", verification: "DISCOVERED", onchainVerifiedAt: null, observedTokenPrograms: { base: TOKEN_2022_PROGRAM_ID.toBase58(), quote: TOKEN_PROGRAM_ID.toBase58() } });
  const program = new PublicKey(p.programId);
  const poolAccount = (owner: PublicKey) => poolAccountFor(owner, p.baseMint, p.quoteMint);
  const ok = classifyPoolVerification(p, poolAccount(program), mintAccount(TOKEN_2022_PROGRAM_ID, 8), mintAccount(TOKEN_PROGRAM_ID, 6), 123, "2026-09-15T00:00:00.000Z");
  assert.equal(ok.verification, "ONCHAIN_VERIFIED");
  const applied = applyVerification(p, ok, "2026-09-15T01:00:00.000Z");
  assert.equal(applied.onchainVerifiedAt, "2026-09-15T01:00:00.000Z");
  assert.equal(applied.enabled, true);
  const wrongOwner = classifyPoolVerification(p, poolAccount(PublicKey.default), mintAccount(TOKEN_2022_PROGRAM_ID, 8), mintAccount(TOKEN_PROGRAM_ID, 6), 123);
  assert.equal(wrongOwner.verification, "VERIFICATION_FAILED");
  assert.match(wrongOwner.detail, /pool owned by/);
  const wrongProgram = classifyPoolVerification(p, poolAccount(program), mintAccount(TOKEN_PROGRAM_ID, 8), mintAccount(TOKEN_PROGRAM_ID, 6), 123);
  assert.match(wrongProgram.detail, /differs from venue metadata/);
  const missing = classifyPoolVerification(p, poolAccount(program), null, mintAccount(TOKEN_PROGRAM_ID, 6), 123);
  const disabled = applyVerification(p, missing, "x");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.onchainVerifiedAt, null);
  assert.match(disabled.disabledReason ?? "", /VERIFICATION_FAILED/);
});

test("raydium native build: flag off, missing options, expired, no RPC, unregistered pool — all refuse before touching the SDK", async () => {
  const request: QuoteRequest = { representationId: rep.id, side: "buy", amount: "99850000", amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint };
  const quote = { ...unavailableQuote("raydium", request, "SDK_ERROR", null, key(1), NOW), unavailableReason: null, expectedAmountOut: SHARES(20n).toString(), expiresAt: new Date(NOW + 10_000).toISOString() };
  const ctx = { connection: null, pools: [pool("raydium", key(1))], now: NOW, deadlineMs: 1000 };
  const off = new RaydiumAdapter({ executionEnabled: false });
  assert.equal((await off.buildSwapInstructions(quote, ctx)).reason, "VENUE_DISABLED");
  /* nativeBuild states that a builder exists, which does not change with the
     execution flag; the flag is enforced in the builder, as the refusal above
     shows. Coupling the two would strip every venue out of the executable
     candidate set whenever execution is off. */
  assert.equal(off.capabilities().nativeBuild, true);
  const on = new RaydiumAdapter({ executionEnabled: true });
  assert.equal(on.capabilities().nativeBuild, true);
  assert.equal((await on.buildSwapInstructions(quote, ctx)).reason, "INVALID_REQUEST");
  const opts = { owner: OWNER, minimumAmountOut: "1" };
  assert.equal((await on.buildSwapInstructions(quote, { ...ctx, now: NOW + 60_000 }, opts)).reason, "QUOTE_EXPIRED");
  assert.equal((await on.buildSwapInstructions(quote, ctx, opts)).reason, "VENUE_NOT_CONFIGURED");
  assert.equal((await on.buildSwapInstructions(quote, { ...ctx, connection: {} as never, pools: [] }, opts)).reason, "NO_VERIFIED_POOL");
  assert.equal((await on.buildSwapInstructions(quote, { ...ctx, connection: {} as never }, { owner: OWNER, minimumAmountOut: (SHARES(20n) + 1n).toString() })).reason, "INVALID_REQUEST");
});

test("client validator accepts the fixture-built transaction and rejects tampering", async () => {
  const plan = singleBuyPlan();
  const legBuilder = async (leg: { programId: string; poolAddress: string }, options: { minimumAmountOut: string }) => ({
    instructions: [new TransactionInstruction({ programId: new PublicKey(leg.programId), keys: [{ pubkey: new PublicKey(OWNER), isSigner: true, isWritable: true }, { pubkey: new PublicKey(leg.poolAddress), isSigner: false, isWritable: true }], data: Buffer.from(options.minimumAmountOut) })],
    lookupTables: [],
    reason: null,
    detail: null,
  });
  const built = await buildTransaction(plan, { executionEnabled: true, blockhash: fixtureBlockhashProvider(), legBuilder, now: NOW });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const summary = { owner: plan.owner, side: plan.side, legs: plan.legs, totals: plan.totals, henarFee: plan.henarFee, requiredPrograms: plan.requiredPrograms, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const expected = { owner: OWNER, inputMint: USDC_MINT, outputMint: rep.mint, amount: 100_000_000n };
  const r = validateRouterTransaction(built.built.transaction, summary, expected, []);
  assert.equal(r.feeTransfers, 1);
  assert.throws(() => validateRouterTransaction(built.built.transaction, { ...summary, henarFee: { ...summary.henarFee, amount: "1" } }, expected, []), /fee amount/);
  assert.throws(() => validateRouterTransaction(built.built.transaction, { ...summary, henarFee: { ...summary.henarFee, destination: key(9) } }, expected, []), /fee destination/);
  assert.throws(() => validateRouterTransaction(built.built.transaction, summary, { ...expected, owner: key(9) }, []), /owner/);
  assert.throws(() => validateRouterTransaction(built.built.transaction, summary, { ...expected, amount: 1n }, []), /amount/);
  assert.throws(() => validateRouterTransaction(built.built.transaction, { ...summary, legs: [{ ...summary.legs[0], programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" }] }, expected, []), /missing venue leg/);
  assert.throws(() => validateRouterTransaction(built.built.transaction, { ...summary, expiresAt: new Date(0).toISOString() }, expected, []), /expired/);
});

test("quoteAndBuild refuses without the execution flag and without builder deps", async () => {
  delete process.env.HENAR_ROUTER_EXECUTION;
  const api = new RouterApi({ adapters: [], connection: null, health: new RouterHealth(null) });
  const r = await api.quoteAndBuild({ representationId: rep.id, side: "buy", amount: "1000000", owner: OWNER });
  assert.equal(r.status, 403);
  process.env.HENAR_ROUTER_EXECUTION = "1";
  const r2 = await api.quoteAndBuild({ representationId: rep.id, side: "buy", amount: "1000000", owner: OWNER });
  assert.equal(r2.status, 503);
  delete process.env.HENAR_ROUTER_EXECUTION;
});

/**
 * Regression: verification must confirm the pool trades the recorded pair.
 *
 * The pass used to check only that the pool account existed under the right
 * program and that the two mints the registry claimed existed somewhere on
 * chain. A record pointing at a real pool trading a different pair verified
 * cleanly, and Native execution trusts the record to choose what it swaps
 * through. All 587 registry pools passed under that rule.
 */
test("a pool trading a different pair than the registry records is refused", () => {
  const program = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
  const p = pool("raydium", key(1), { programId: program.toBase58(), verification: "DISCOVERED", onchainVerifiedAt: null, observedTokenPrograms: null });
  const mints = [mintAccount(TOKEN_2022_PROGRAM_ID, 8), mintAccount(TOKEN_PROGRAM_ID, 6)] as const;

  // The pair the registry records: verified.
  const right = classifyPoolVerification(p, poolAccountFor(program, p.baseMint, p.quoteMint), ...mints, 123);
  assert.equal(right.verification, "ONCHAIN_VERIFIED");
  assert.match(right.detail, /pool pair, owner and both mints verified/);

  // Reversed order is the same unordered pair, so it is still the same market.
  const reversed = classifyPoolVerification(p, poolAccountFor(program, p.quoteMint, p.baseMint), ...mints, 123);
  assert.equal(reversed.verification, "ONCHAIN_VERIFIED");

  // A real pool under the right program, trading something else entirely.
  const wrongPair = classifyPoolVerification(p, poolAccountFor(program, key(77), p.quoteMint), ...mints, 123);
  assert.equal(wrongPair.verification, "VERIFICATION_FAILED");
  assert.match(wrongPair.detail, /pool trades .*, registry says/);
  const applied = applyVerification(p, wrongPair, "2026-09-15T01:00:00.000Z");
  assert.equal(applied.enabled, false);
  assert.equal(applied.onchainVerifiedAt, null);

  // An account too short to hold the pair is unverified, never verified by default.
  const truncated = classifyPoolVerification(p, poolAccountFor(program, p.baseMint, p.quoteMint, 8), ...mints, 123);
  assert.equal(truncated.verification, "VERIFICATION_FAILED");
  assert.match(truncated.detail, /too short for the clmm layout/);

  /* A layout with no decoder cannot be called verified: it stays DISCOVERED,
     keeps its existing enablement, and carries no verification timestamp.
     DBC and DAMM v2 are the two that still have none; DLMM gained one with
     the private-market products and is exercised below. */
  const undecodable = pool("meteora-dbc", key(2), { programId: program.toBase58(), verification: "DISCOVERED", onchainVerifiedAt: null, observedTokenPrograms: null, enabled: false, disabledReason: "no direct adapter" });
  const pending = classifyPoolVerification(undecodable, poolAccountFor(program, undecodable.baseMint, undecodable.quoteMint), ...mints, 123);
  assert.equal(pending.verification, "DISCOVERED");
  assert.match(pending.detail, /no decoder for dbc/);
  const kept = applyVerification(undecodable, pending, "2026-09-15T01:00:00.000Z");
  assert.equal(kept.onchainVerifiedAt, null);
  assert.equal(kept.disabledReason, "no direct adapter");
});

test("a DLMM pool's pair is confirmed from its own account, so private-market markets verify rather than staying DISCOVERED", () => {
  const program = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
  const p = pool("meteora", key(3), { programId: program.toBase58(), poolType: "dlmm", verification: "DISCOVERED", onchainVerifiedAt: null, observedTokenPrograms: null });
  const lbPair = (x: string, y: string) => {
    const data = Buffer.alloc(904);
    new PublicKey(x).toBuffer().copy(data, 88);
    new PublicKey(y).toBuffer().copy(data, 120);
    return { owner: program, data, executable: false, lamports: 1, rentEpoch: 0 };
  };
  const mints = [mintAccount(TOKEN_2022_PROGRAM_ID, 9), mintAccount(TOKEN_PROGRAM_ID, 6)] as const;
  const ok = classifyPoolVerification(p, lbPair(p.baseMint, p.quoteMint), ...mints, 500);
  assert.equal(ok.verification, "ONCHAIN_VERIFIED");
  const wrong = classifyPoolVerification(p, lbPair(key(77), p.quoteMint), ...mints, 500);
  assert.equal(wrong.verification, "VERIFICATION_FAILED");
  assert.match(wrong.detail, /pool trades .*, registry says/);
});

test("the validator refuses a smuggled token instruction and a server-chosen program", async () => {
  /* The token programs were allowed wholesale and only TransferChecked was
     ever read, so a plan carrying an extra SetAuthority on the owner's own
     account validated, simulated cleanly and reached the wallet. The owner is
     a legitimate signer, so the foreign-signer check never fired either. */
  const plan = singleBuyPlan();
  const smuggle = (programId: PublicKey, data: Buffer) => async (
    leg: { programId: string; poolAddress: string },
    options: { minimumAmountOut: string },
  ) => ({
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(leg.programId),
        keys: [
          { pubkey: new PublicKey(OWNER), isSigner: true, isWritable: true },
          { pubkey: new PublicKey(leg.poolAddress), isSigner: false, isWritable: true },
        ],
        data: Buffer.from(options.minimumAmountOut),
      }),
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: new PublicKey(key(7)), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(key(8)), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(OWNER), isSigner: true, isWritable: false },
        ],
        data,
      }),
    ],
    lookupTables: [],
    reason: null,
    detail: null,
  });
  const summary = {
    owner: plan.owner, side: plan.side, legs: plan.legs, totals: plan.totals,
    henarFee: plan.henarFee, requiredPrograms: plan.requiredPrograms,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const expected = { owner: OWNER, inputMint: USDC_MINT, outputMint: rep.mint, amount: 100_000_000n };

  // SetAuthority (6) retargeting one of the owner's own token accounts.
  for (const [label, opcode] of [["SetAuthority", 6], ["Approve", 4], ["Transfer", 3], ["Burn", 8], ["CloseAccount", 9]] as const) {
    const data = Buffer.alloc(10);
    data[0] = opcode;
    const built = await buildTransaction(plan, {
      executionEnabled: true, blockhash: fixtureBlockhashProvider(),
      legBuilder: smuggle(TOKEN_PROGRAM_ID, data), now: NOW,
    });
    assert.equal(built.ok, true, `${label}: fixture should build`);
    if (!built.ok) return;
    assert.throws(
      () => validateRouterTransaction(built.built.transaction, summary, expected, []),
      /token instruction/,
      `${label} must be refused`,
    );
  }

  // Token-2022 is held to the same rule.
  const t22 = Buffer.alloc(10);
  t22[0] = 6;
  const built2022 = await buildTransaction(plan, {
    executionEnabled: true, blockhash: fixtureBlockhashProvider(),
    legBuilder: smuggle(TOKEN_2022_PROGRAM_ID, t22), now: NOW,
  });
  if (built2022.ok)
    assert.throws(() => validateRouterTransaction(built2022.built.transaction, summary, expected, []), /token instruction/);

  // An aggregator leg may narrow the allowlist, never extend it.
  const good = await buildTransaction(plan, {
    executionEnabled: true, blockhash: fixtureBlockhashProvider(),
    legBuilder: async (leg: { programId: string; poolAddress: string }, options: { minimumAmountOut: string }) => ({
      instructions: [new TransactionInstruction({ programId: new PublicKey(leg.programId), keys: [{ pubkey: new PublicKey(OWNER), isSigner: true, isWritable: true }], data: Buffer.from(options.minimumAmountOut) })],
      lookupTables: [], reason: null, detail: null,
    }),
    now: NOW,
  });
  if (!good.ok) return;
  assert.throws(
    () =>
      validateRouterTransaction(
        good.built.transaction,
        { ...summary, legs: [{ ...summary.legs[0], programId: "aggregator:x", programIds: [key(9)] }] },
        expected,
        [],
      ),
    /aggregator program/,
    "a program named only by the server must not become allowed",
  );
});
