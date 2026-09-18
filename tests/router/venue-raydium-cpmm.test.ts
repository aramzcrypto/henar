/**
 * Raydium CPMM adapter, offline. Chain state is injected through the
 * adapter's `readPool` option, so the SDK curve runs on known reserves and
 * every fail-closed branch is exercised without RPC.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CurveCalculator } from "@raydium-io/raydium-sdk-v2";
import { USDC_MINT, buildPoolRegistry, type QuoteContext, type QuoteRequest } from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY } from "@henar/execution-guard";
import { planExecution } from "@henar/tx-builder";
import { RAYDIUM_CLMM_PROGRAM, RAYDIUM_CPMM_PROGRAM, RaydiumCpmmAdapter, cpmmPriceImpactBps, type CpmmPoolState } from "@henar/venue-raydium";
import { DEC, NOW, OWNER, SHARES, TREASURY, approve, buy, key, pool, quoteFor, rep, representation } from "./fixtures/plan";

const POOL = key(7);
const cpmmPool = (overrides: Parameters<typeof pool>[2] = {}) => pool("raydium", POOL, { poolType: "cpmm", programId: RAYDIUM_CPMM_PROGRAM, ...overrides });
const clmmPool = () => pool("raydium", key(8), { poolType: "clmm", programId: RAYDIUM_CLMM_PROGRAM });

/** 1,000,000 USDC against 10,000 shares; 0.25% trade fee, no creator fee. */
function state(overrides: Partial<CpmmPoolState> = {}): CpmmPoolState {
  return {
    poolId: POOL,
    programId: RAYDIUM_CPMM_PROGRAM,
    mintA: { address: USDC_MINT, programId: TOKEN_PROGRAM_ID.toBase58(), decimals: 6, hasTransferFee: false },
    mintB: { address: rep.mint, programId: TOKEN_2022_PROGRAM_ID.toBase58(), decimals: DEC, hasTransferFee: false },
    vaultA: key(20),
    vaultB: key(21),
    authority: key(22),
    configId: key(23),
    observationId: key(24),
    reserveA: 1_000_000_000_000n,
    reserveB: SHARES(10_000n),
    tradeFeeRate: 2_500n,
    creatorFeeRate: 0n,
    protocolFeeRate: 120_000n,
    fundFeeRate: 40_000n,
    enableCreatorFee: false,
    feeOn: 0,
    status: 0,
    openTime: 0n,
    ...overrides,
  };
}

const request: QuoteRequest = buy("100000000");
const ctx = (overrides: Partial<QuoteContext> = {}): QuoteContext => ({ connection: null, pools: [], now: NOW, deadlineMs: 5000, ...overrides });
const adapterWith = (s: CpmmPoolState, executionEnabled = false) => new RaydiumCpmmAdapter({ executionEnabled, readPool: async () => s });

test("cpmm: offline refusals — no pool, CLMM-only, no RPC, wrong pair, exact-out", async () => {
  const bare = new RaydiumCpmmAdapter({ executionEnabled: false });
  assert.equal((await bare.getQuote(request, ctx())).unavailableReason, "NO_VERIFIED_POOL");
  assert.equal((await bare.getQuote(request, ctx({ pools: [clmmPool()] }))).unavailableReason, "NO_VERIFIED_POOL");
  const noRpc = await bare.getQuote(request, ctx({ pools: [cpmmPool()] }));
  assert.equal(noRpc.unavailableReason, "VENUE_NOT_CONFIGURED");
  assert.equal(noRpc.poolAddress, POOL);
  const injected = adapterWith(state());
  const wrongPair = await injected.getQuote({ ...request, inputMint: key(99) }, ctx({ pools: [cpmmPool()] }));
  assert.equal(wrongPair.unavailableReason, "QUOTE_TERMS_MISMATCH");
  assert.equal((await injected.getQuote({ ...request, amountType: "output" }, ctx({ pools: [cpmmPool()] }))).unavailableReason, "NOT_IMPLEMENTED");
  assert.equal((await injected.getQuote({ ...request, amount: "0" }, ctx({ pools: [cpmmPool()] }))).unavailableReason, "INVALID_REQUEST");
  assert.equal((await bare.curve(request, cpmmPool(), ctx())), null);
  assert.equal((await injected.curve(request, clmmPool(), ctx())), null);
});

test("cpmm: quote matches CurveCalculator.swapBaseInput on the injected reserves", async () => {
  const s = state();
  const adapter = adapterWith(s);
  const quote = await adapter.getQuote(request, ctx({ pools: [cpmmPool()] }));
  assert.equal(quote.unavailableReason, null, quote.unavailableDetail ?? "");
  const expected = CurveCalculator.swapBaseInput(
    new BN(request.amount),
    new BN(s.reserveA.toString()),
    new BN(s.reserveB.toString()),
    new BN(s.tradeFeeRate.toString()),
    new BN(0),
    new BN(s.protocolFeeRate.toString()),
    new BN(s.fundFeeRate.toString()),
    true,
  );
  assert.equal(quote.amountIn, request.amount);
  assert.equal(quote.expectedAmountOut, expected.outputAmount.toString());
  assert.equal(quote.venueFeeAmount, expected.tradeFee.add(expected.creatorFee).toString());
  assert.equal(quote.venueFeeBps, 25);
  assert.equal(quote.source, "raydium-sdk-v2 CurveCalculator.swapBaseInput");
  assert.equal(quote.executionPath, "none");
  assert.equal(quote.onchainCheckedAtQuote, true);
  assert.equal(quote.slot, null);
  assert.equal(quote.minimumAmountOut, null);
  assert.equal(Date.parse(quote.expiresAt) - Date.parse(quote.quotedAt), 15_000);
  // Hand check with fees off: out = floor(in·Rout / (Rin + in)).
  const feeless = adapterWith(state({ tradeFeeRate: 0n }));
  const q0 = await feeless.getQuote(request, ctx({ pools: [cpmmPool()] }));
  const amountIn = BigInt(request.amount);
  assert.equal(q0.expectedAmountOut, ((amountIn * s.reserveB) / (s.reserveA + amountIn)).toString());
  assert.equal(q0.venueFeeAmount, "0");
  // 100 USDC into a 1M USDC pool: ~1 bp of impact plus the 25 bp fee.
  assert.equal(q0.priceImpactBps, 1);
  assert.equal(quote.priceImpactBps, 26);
  assert.equal(cpmmPriceImpactBps(amountIn, BigInt(q0.expectedAmountOut), s.reserveA, s.reserveB), 1);
  // Sell direction reads the reserves the other way round.
  const sellQuote = await adapter.getQuote({ ...request, side: "sell", inputMint: rep.mint, outputMint: USDC_MINT, amount: SHARES(1n).toString() }, ctx({ pools: [cpmmPool()] }));
  assert.equal(sellQuote.unavailableReason, null);
  assert.ok(BigInt(sellQuote.expectedAmountOut) > 99_000_000n && BigInt(sellQuote.expectedAmountOut) < 100_000_000n);
  // The creator fee applies only when the pool has it enabled.
  const creatorOff = await adapterWith(state({ creatorFeeRate: 10_000n })).getQuote(request, ctx({ pools: [cpmmPool()] }));
  const creatorOn = await adapterWith(state({ creatorFeeRate: 10_000n, enableCreatorFee: true })).getQuote(request, ctx({ pools: [cpmmPool()] }));
  assert.equal(creatorOff.expectedAmountOut, quote.expectedAmountOut);
  assert.ok(BigInt(creatorOn.expectedAmountOut) < BigInt(quote.expectedAmountOut));
  assert.equal(creatorOn.venueFeeBps, 125);
});

test("cpmm: curve() is pure over the reserves read once and quoteFor round-trips", async () => {
  let reads = 0;
  const s = state();
  const adapter = new RaydiumCpmmAdapter({ executionEnabled: false, readPool: async () => { reads += 1; return s; } });
  const curve = await adapter.curve(request, cpmmPool(), ctx());
  assert.ok(curve && curve.available && curve.quoteFor);
  assert.equal(curve.poolAddress, POOL);
  const quoteLeg = curve.quoteFor;
  const direct = await adapter.getQuote(request, ctx({ pools: [cpmmPool()] }));
  // A dust input rounds to zero output: the curve says null and the leg quote fails closed.
  assert.equal(curve.outputFor(1n), null);
  assert.equal(quoteLeg(1n).unavailableReason, "INSUFFICIENT_LIQUIDITY");
  for (const amount of [5_000_000n, 100_000_000n, 250_000_000_000n]) {
    const out = curve.outputFor(amount);
    const q = quoteLeg(amount);
    assert.equal(q.amountIn, amount.toString());
    assert.equal(q.expectedAmountOut, out?.toString());
    assert.equal(q.unavailableReason, null);
    assert.equal(q.source, "raydium-sdk-v2 CurveCalculator.swapBaseInput (split leg)");
  }
  assert.equal(curve.outputFor(100_000_000n)?.toString(), direct.expectedAmountOut);
  assert.equal(curve.outputFor(0n), 0n);
  // Concavity: doubling the input never doubles the output.
  assert.ok(curve.outputFor(200_000_000n)! < curve.outputFor(100_000_000n)! * 2n);
  assert.equal(reads, 2, "one read for curve(), one for getQuote(); evaluations do no I/O");
});

test("cpmm: chain-vs-registry checks refuse mismatched, fee-bearing and closed pools", async () => {
  const pools = [cpmmPool()];
  const run = (s: CpmmPoolState) => adapterWith(s).getQuote(request, ctx({ pools }));
  assert.equal((await run(state({ mintB: { ...state().mintB, address: key(77) } }))).unavailableReason, "QUOTE_TERMS_MISMATCH");
  assert.equal((await run(state({ programId: RAYDIUM_CLMM_PROGRAM }))).unavailableReason, "QUOTE_TERMS_MISMATCH");
  assert.equal((await run(state({ mintB: { ...state().mintB, hasTransferFee: true } }))).unavailableReason, "UNSUPPORTED_TOKEN_EXTENSION");
  assert.equal((await run(state({ status: 1 << 2 }))).unavailableReason, "POOL_INACTIVE");
  assert.equal((await run(state({ openTime: BigInt(Math.floor(NOW / 1000)) + 60n }))).unavailableReason, "POOL_INACTIVE");
  assert.equal((await run(state({ reserveB: 0n }))).unavailableReason, "INSUFFICIENT_LIQUIDITY");
  const thrown = new RaydiumCpmmAdapter({ executionEnabled: false, readPool: async () => { throw new Error("request timeout"); } });
  assert.equal((await thrown.getQuote(request, ctx({ pools }))).unavailableReason, "VENUE_TIMEOUT");
  assert.equal((await adapterWith(state({ status: 1 << 2 })).curve(request, cpmmPool(), ctx())), null);
});

test("cpmm: execution flag gates the native path and the build", async () => {
  const off = adapterWith(state(), false);
  // Capability, not switch: the builder exists and refuses below.
  assert.equal(off.capabilities().nativeBuild, true);
  assert.deepEqual(off.capabilities().poolTypes, ["cpmm"]);
  const quote = await off.getQuote(request, ctx({ pools: [cpmmPool()] }));
  assert.equal(quote.executionPath, "none");
  const refused = await off.buildSwapInstructions(quote, ctx({ pools: [cpmmPool()] }), { owner: OWNER, minimumAmountOut: quote.expectedAmountOut });
  assert.equal(refused.reason, "VENUE_DISABLED");
  assert.equal(refused.instructions.length, 0);
  const on = adapterWith(state(), true);
  assert.equal(on.capabilities().nativeBuild, true);
  assert.equal((await on.getQuote(request, ctx({ pools: [cpmmPool()] }))).executionPath, "henar-native");
});

test("cpmm: build emits one swap-base-in instruction carrying the guard floor, owner as sole signer", async () => {
  const pools = [cpmmPool()];
  const adapter = adapterWith(state(), true);
  const quote = await adapter.getQuote(request, ctx({ pools }));
  const floor = (BigInt(quote.expectedAmountOut) * 9_950n) / 10_000n;
  const built = await adapter.buildSwapInstructions(quote, ctx({ pools }), { owner: OWNER, minimumAmountOut: floor.toString() });
  assert.equal(built.reason, null, built.detail ?? "");
  assert.equal(built.instructions.length, 1);
  const ix = built.instructions[0];
  assert.equal(ix.programId.toBase58(), RAYDIUM_CPMM_PROGRAM);
  const signers = ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58());
  assert.deepEqual(signers, [OWNER]);
  const accounts = ix.keys.map((k) => k.pubkey.toBase58());
  for (const expected of [key(22), key(23), POOL, key(20), key(21), key(24), USDC_MINT, rep.mint]) assert.ok(accounts.includes(expected), expected);
  // Anchor data: 8-byte discriminator, then amount_in u64 LE, then minimum_amount_out u64 LE.
  assert.equal(ix.data.length, 24);
  assert.equal(ix.data.readBigUInt64LE(8).toString(), quote.amountIn);
  assert.equal(ix.data.readBigUInt64LE(16), floor);
  assert.equal(built.lookupTables.length, 0);

  // Missing options / expired quote / floor above the quote.
  assert.equal((await adapter.buildSwapInstructions(quote, ctx({ pools }))).reason, "INVALID_REQUEST");
  assert.equal((await adapter.buildSwapInstructions(quote, ctx({ pools, now: NOW + 60_000 }), { owner: OWNER, minimumAmountOut: floor.toString() })).reason, "QUOTE_EXPIRED");
  assert.equal((await adapter.buildSwapInstructions(quote, ctx({ pools }), { owner: OWNER, minimumAmountOut: (BigInt(quote.expectedAmountOut) + 1n).toString() })).reason, "INVALID_REQUEST");
  assert.equal((await adapter.buildSwapInstructions(quote, ctx({ pools: [] }), { owner: OWNER, minimumAmountOut: floor.toString() })).reason, "NO_VERIFIED_POOL");

  // State moved between quote and build: output now below the floor → refuse.
  const drained = new RaydiumCpmmAdapter({ executionEnabled: true, readPool: async () => state({ reserveB: SHARES(9_000n) }) });
  const moved = await drained.buildSwapInstructions(quote, ctx({ pools }), { owner: OWNER, minimumAmountOut: floor.toString() });
  assert.equal(moved.reason, "SLIPPAGE_LIMIT_EXCEEDED");
  assert.equal(moved.instructions.length, 0);
  // Transfer-fee mint appearing at build time is refused too.
  const feeMint = new RaydiumCpmmAdapter({ executionEnabled: true, readPool: async () => state({ mintA: { ...state().mintA, hasTransferFee: true } }) });
  assert.equal((await feeMint.buildSwapInstructions(quote, ctx({ pools }), { owner: OWNER, minimumAmountOut: floor.toString() })).reason, "UNSUPPORTED_TOKEN_EXTENSION");
});

test("planner: a cpmm registry pool stamps the leg with the CPMM program id", () => {
  const pools = [cpmmPool()];
  const verdict = approve(quoteFor("raydium", buy(), SHARES(20n), POOL), pools);
  const plan = planExecution({ representation, side: "buy", owner: OWNER, treasuryOwner: TREASURY, userInput: 100_000_000n, legs: [{ verdict }], policy: DEFAULT_EXECUTION_POLICY, registry: buildPoolRegistry(pools), now: NOW });
  assert.equal(plan.legs[0].programId, RAYDIUM_CPMM_PROGRAM);
  assert.ok(plan.requiredPrograms.includes(RAYDIUM_CPMM_PROGRAM));
  assert.ok(!plan.requiredPrograms.includes(RAYDIUM_CLMM_PROGRAM));
  // A clmm record keeps the CLMM program, as before.
  const clmm = [clmmPool()];
  const v2 = approve(quoteFor("raydium", buy(), SHARES(20n), key(8)), clmm);
  const plan2 = planExecution({ representation, side: "buy", owner: OWNER, treasuryOwner: TREASURY, userInput: 100_000_000n, legs: [{ verdict: v2 }], policy: DEFAULT_EXECUTION_POLICY, registry: buildPoolRegistry(clmm), now: NOW });
  assert.equal(plan2.legs[0].programId, RAYDIUM_CLMM_PROGRAM);
  assert.ok(new PublicKey(plan.legs[0].programId));
});
