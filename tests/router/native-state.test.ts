/**
 * Task 10: Henar-decoded state feeds the same pure SDK math the adapters
 * use. FIXTURES: pools are synthesized by the SDKs' own builders, encoded
 * with the official IDL coder, then decoded by Henar's readers. Nothing here
 * is live state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import * as cp from "@meteora-ag/cp-amm-sdk";
import { USDC_MINT, calculatorFor, camelizeKeys, listCalculators, listRouterRepresentations } from "@henar/router-core";
import { dbcCalculator, dbcStateReader, encodeDbcFixture } from "@henar/venue-meteora-dbc";
import { dammV2Calculator, dammV2StateReader, encodeDammV2Fixture } from "@henar/venue-meteora-damm-v2";
import "@henar/venue-raydium";
import "@henar/venue-meteora";
import { CURRENT_POINT, buildDbcMarket } from "./fixtures/meteora-dbc";
import { buildDammV2Market } from "./fixtures/meteora-damm-v2";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const DBC_PROGRAM = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const DAMM_PROGRAM = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const account = (owner: PublicKey, data: Buffer) => ({ owner, data, executable: false, lamports: 1, rentEpoch: 0 });

test("camelizeKeys renames nested snake_case keys and leaves BN/PublicKey/Buffer intact", () => {
  const out = camelizeKeys<{ poolState: { sqrtPrice: BN; baseMint: PublicKey; metrics: { totalFee: number }; padding: number[] } }>({
    pool_state: { sqrt_price: new BN(5), base_mint: PublicKey.default, metrics: { total_fee: 1 }, _padding: [1, 2] },
  });
  assert.ok(BN.isBN(out.poolState.sqrtPrice));
  assert.ok(out.poolState.baseMint instanceof PublicKey);
  assert.equal(out.poolState.metrics.totalFee, 1);
  assert.deepEqual(out.poolState.padding, [1, 2]);
});

test("calculator registry lists four pool types with honest statuses", () => {
  const list = Object.fromEntries(listCalculators().map((c) => [c.poolType, c.status]));
  assert.equal(list.dbc, "SDK_BACKED");
  assert.equal(list.damm_v2, "SDK_BACKED");
  assert.equal(list.clmm, "LIVE_VALIDATION_PENDING");
  assert.equal(list.dlmm, "LIVE_VALIDATION_PENDING");
});

test("DBC: encode fixture → decode with Henar reader → native quote equals SDK quote on the original fixture, integer-exact", async () => {
  const market = buildDbcMarket({ poolAddress: key(1), configAddress: key(2), baseMint: rep.mint });
  const bytes = await encodeDbcFixture(market.pool, market.config);
  const state = dbcStateReader.decode(key(1), account(DBC_PROGRAM, bytes.pool), { [key(2)]: account(DBC_PROGRAM, bytes.config) });
  assert.equal(state.decoded.configAddress, key(2));
  assert.equal(state.decoded.pool.poolState.baseMint.toBase58(), rep.mint);
  assert.equal(state.decoded.config.migrationQuoteThreshold.toString(), market.config.migrationQuoteThreshold.toString());
  for (const amount of [1_000_000n, 100_000_000n, 10_000_000_000n]) {
    const native = dbcCalculator.quote(state, { inputMint: USDC_MINT, outputMint: rep.mint, amountIn: amount, currentPoint: CURRENT_POINT });
    const sdk = dbc.swapQuoteExactIn(market.pool, market.config, false, new BN(amount.toString()), 0, false, new BN(CURRENT_POINT.toString()), false);
    assert.equal(native.amountOut, BigInt(sdk.outputAmount.toString()));
    assert.equal(native.venueFee, BigInt(sdk.tradingFee.add(sdk.protocolFee).add(sdk.referralFee).toString()));
    assert.equal(native.detail.nextSqrtPrice, sdk.nextSqrtPrice.toString());
  }
  assert.throws(() => dbcStateReader.decode(key(1), account(PublicKey.default, bytes.pool), {}), /not owned by the DBC program/);
  assert.throws(() => dbcStateReader.decode(key(1), account(DBC_PROGRAM, bytes.pool), {}), /config account/);
  assert.throws(() => dbcCalculator.quote(state, { inputMint: key(9), outputMint: rep.mint, amountIn: 1n, currentPoint: CURRENT_POINT }), /pool pair/);
});

test("DAMM v2: encode fixture → decode → native quote equals SDK quote", async () => {
  const market = buildDammV2Market({ poolAddress: key(3), tokenAMint: rep.mint });
  const bytes = await encodeDammV2Fixture(market.pool);
  const state = dammV2StateReader.withDecimals(8, 6).decode(key(3), account(DAMM_PROGRAM, bytes));
  assert.equal(state.decoded.pool.tokenAMint.toBase58(), rep.mint);
  assert.equal(state.decoded.pool.sqrtPrice.toString(), market.pool.sqrtPrice.toString());
  for (const amount of [1_000_000n, 100_000_000n]) {
    const native = dammV2Calculator.quote(state, { inputMint: USDC_MINT, outputMint: rep.mint, amountIn: amount, currentPoint: CURRENT_POINT });
    const sdk = cp.swapQuoteExactInput(market.pool, new BN(CURRENT_POINT.toString()), new BN(amount.toString()), 0, false, false, 8, 6);
    assert.equal(native.amountOut, BigInt(sdk.outputAmount.toString()));
  }
  const sell = dammV2Calculator.quote(state, { inputMint: rep.mint, outputMint: USDC_MINT, amountIn: 1_000_000_000n, currentPoint: CURRENT_POINT });
  const sdkSell = cp.swapQuoteExactInput(market.pool, new BN(CURRENT_POINT.toString()), new BN("1000000000"), 0, true, false, 8, 6);
  assert.equal(sell.amountOut, BigInt(sdkSell.outputAmount.toString()));
  assert.throws(() => dammV2StateReader.decode(key(3), account(PublicKey.default, bytes)), /not owned by the DAMM v2 program/);
});

test("live-pending calculators refuse to quote without SDK-fetched state instead of guessing", () => {
  const clmm = calculatorFor("clmm")!;
  const dlmm = calculatorFor("dlmm")!;
  const base = { venue: "raydium" as const, poolType: "clmm" as const, poolAddress: key(4), programId: key(5), slot: null, readAt: "", source: "fixture" as const, baseMint: null, quoteMint: null };
  assert.throws(() => clmm.quote({ ...base, decoded: { poolInfo: {}, computePoolInfo: null, tickArrayCache: null, tokenOut: null, epochInfo: null } }, { inputMint: USDC_MINT, outputMint: rep.mint, amountIn: 1n, currentPoint: 0n }), /LIVE_VALIDATION_PENDING/);
  assert.throws(() => dlmm.quote({ ...base, venue: "meteora", poolType: "dlmm", decoded: { lbPair: {}, instance: null, binArrays: null } }, { inputMint: USDC_MINT, outputMint: rep.mint, amountIn: 1n, currentPoint: 0n }), /LIVE_VALIDATION_PENDING/);
});
