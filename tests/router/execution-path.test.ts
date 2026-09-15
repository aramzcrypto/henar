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
const poolAccount = (owner: PublicKey) => ({ owner, data: Buffer.alloc(8), executable: false, lamports: 1, rentEpoch: 0 });

test("on-chain verification: ONCHAIN_VERIFIED only when owner and both mints agree; failures disable the pool and keep the timestamp null", () => {
  const p = pool("raydium", key(1), { programId: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", verification: "DISCOVERED", onchainVerifiedAt: null, observedTokenPrograms: { base: TOKEN_2022_PROGRAM_ID.toBase58(), quote: TOKEN_PROGRAM_ID.toBase58() } });
  const program = new PublicKey(p.programId);
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
  assert.equal(off.capabilities().nativeBuild, false);
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
