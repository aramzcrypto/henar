/**
 * Meteora DAMM v2 adapter, offline. `swapQuoteExactInput` from the official
 * cp-amm SDK is the oracle; amounts must match integer-exact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import BN from "bn.js";
import * as cp from "@meteora-ag/cp-amm-sdk";
import {
  USDC_MINT,
  listRouterRepresentations,
  quoteRepresentation,
  type DammV2QuoteMetadata,
  type QuoteContext,
  type QuoteRequest,
  type VerifiedPool,
} from "@henar/router-core";
import { MeteoraDammV2Adapter, type DammV2MarketState } from "@henar/venue-meteora-damm-v2";
import { MeteoraAdapter } from "@henar/venue-meteora";
import { CURRENT_POINT } from "./fixtures/meteora-dbc";
import { buildDammV2Market } from "./fixtures/meteora-damm-v2";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
import { PublicKey } from "@solana/web3.js";
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const POOL = key(21);
const LAUNCH = key(22);
const NOW = Date.now();

function registryPool(overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  return {
    id: `meteora-damm-v2:${POOL}`,
    representationId: rep.id,
    mint: rep.mint,
    provider: rep.provider,
    tokenSymbol: rep.tokenSymbol,
    venue: "meteora-damm-v2",
    address: POOL,
    programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    poolType: "damm_v2",
    baseMint: rep.mint,
    quoteMint: USDC_MINT,
    feeBps: 100,
    feeConfig: null,
    observedTokenPrograms: null,
    tvlUsd: null,
    discoveredFrom: "test",
    discoveredAt: "2026-09-15T00:00:00.000Z",
    verifiedAt: "2026-09-15T00:00:00.000Z",
    verification: "DISCOVERED",
    onchainVerifiedAt: null,
    verificationDetail: null,
    eligibility: "ROUTER_ELIGIBLE",
    dbc: null,
    enabled: true,
    disabledReason: null,
    ...overrides,
  };
}

const base = { poolAddress: POOL, tokenAMint: rep.mint };
const ctx = (pools: VerifiedPool[], now = NOW): QuoteContext => ({ connection: null, pools, now, deadlineMs: 5000 });
const buy = (amount: string): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint });
const sell = (amount: string): QuoteRequest => ({ representationId: rep.id, side: "sell", amount, amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT });
const adapterFor = (market: DammV2MarketState | null) => new MeteoraDammV2Adapter({ quotesEnabled: true, readMarket: async () => market });

for (const [label, amount] of [["small", "1000000"], ["medium", "100000000"], ["large", "10000000000"]] as const) {
  test(`DAMM v2 buy (${label}) equals swapQuoteExactInput exactly`, async () => {
    const market = buildDammV2Market(base);
    const q = await adapterFor(market).getQuote(buy(amount), ctx([registryPool()]));
    assert.equal(q.unavailableReason, null, q.unavailableDetail ?? "");
    const sdk = cp.swapQuoteExactInput(market.pool, new BN(CURRENT_POINT.toString()), new BN(amount), 0, false, false, 8, 6);
    assert.equal(q.expectedAmountOut, sdk.outputAmount.toString());
    assert.equal(q.venueFeeAmount, sdk.claimingFee.add(sdk.protocolFee).add(sdk.compoundingFee).add(sdk.referralFee).toString());
    assert.equal(q.priceImpactBps, Math.floor(Number(sdk.priceImpact.toString()) * 100));
    const meta = q.rawRouteMetadata as DammV2QuoteMetadata;
    assert.equal(meta.kind, "meteora-damm-v2");
    assert.equal(meta.poolStatus, "Enable");
    assert.equal(meta.nextSqrtPrice, sdk.nextSqrtPrice.toString());
    assert.equal(meta.currentFeeBps, 100);
  });
}

test("DAMM v2 sell equals the SDK", async () => {
  const market = buildDammV2Market(base);
  const q = await adapterFor(market).getQuote(sell("1000000000"), ctx([registryPool()]));
  assert.equal(q.unavailableReason, null, q.unavailableDetail ?? "");
  const sdk = cp.swapQuoteExactInput(market.pool, new BN(CURRENT_POINT.toString()), new BN("1000000000"), 0, true, false, 8, 6);
  assert.equal(q.expectedAmountOut, sdk.outputAmount.toString());
});

test("disabled pool and not-yet-active pool → POOL_INACTIVE", async () => {
  const disabled = buildDammV2Market({ ...base, poolStatus: 1 });
  assert.equal((await adapterFor(disabled).getQuote(buy("1000000"), ctx([registryPool()]))).unavailableReason, "POOL_INACTIVE");
  const future = buildDammV2Market({ ...base, activationPoint: CURRENT_POINT + 10n });
  assert.equal((await adapterFor(future).getQuote(buy("1000000"), ctx([registryPool()]))).unavailableReason, "POOL_INACTIVE");
});

test("wrong mints, flag/program disagreement, stale state, unsupported extension", async () => {
  const wrong = buildDammV2Market({ ...base, tokenAMint: LAUNCH });
  assert.equal((await adapterFor(wrong).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const flagged = buildDammV2Market(base);
  flagged.tokenA = { ...flagged.tokenA!, isToken2022: false };
  assert.equal((await adapterFor(flagged).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const stale = buildDammV2Market({ ...base, readAt: new Date(NOW - 60_000).toISOString() });
  assert.equal((await adapterFor(stale).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "STALE_STATE");
  const hooked = buildDammV2Market(base);
  hooked.tokenA = { ...hooked.tokenA!, supported: false, unsupportedReason: "transfer hook X" };
  assert.equal((await adapterFor(hooked).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "UNSUPPORTED_TOKEN_EXTENSION");
});

test("flag off, no pool, infra-only, missing on chain", async () => {
  const off = new MeteoraDammV2Adapter({ quotesEnabled: false, readMarket: async () => buildDammV2Market(base) });
  assert.equal((await off.getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "VENUE_DISABLED");
  assert.equal((await adapterFor(buildDammV2Market(base)).getQuote(buy("1"), ctx([]))).unavailableReason, "NO_VERIFIED_POOL");
  const infra = registryPool({ baseMint: LAUNCH, quoteMint: rep.mint, eligibility: "STOCK_PAIRED_INFRASTRUCTURE", enabled: false, disabledReason: "infra" });
  assert.equal((await adapterFor(buildDammV2Market(base)).getQuote(buy("1"), ctx([infra]))).unavailableReason, "NOT_ROUTER_ELIGIBLE");
  assert.equal((await adapterFor(null).getQuote(buy("1"), ctx([registryPool()]))).unavailableReason, "NO_VERIFIED_POOL");
});

test("a DAMM v2 pool never reaches the DLMM adapter", async () => {
  // The DLMM adapter filters on venue "meteora" and program LBUZK…; a
  // DAMM v2 registry record is invisible to it.
  const dlmm = new MeteoraAdapter();
  const q = await dlmm.getQuote(buy("1"), ctx([registryPool()]));
  assert.equal(q.unavailableReason, "NO_VERIFIED_POOL");
});

test("engine ranks a DAMM v2 quote with the fee breakdown intact", async () => {
  const market = buildDammV2Market(base);
  const adapter = new MeteoraDammV2Adapter({ quotesEnabled: true, readMarket: async () => market });
  const original = adapter.getQuote.bind(adapter);
  adapter.getQuote = (request, c) => original(request, { ...c, pools: [registryPool()] });
  const result = await quoteRepresentation(buy("100000000"), { adapters: [adapter], enabled: true });
  assert.equal(result.best?.venue, "meteora-damm-v2");
  const sdk = cp.swapQuoteExactInput(market.pool, new BN(CURRENT_POINT.toString()), new BN("99850000"), 0, false, false, 8, 6);
  assert.equal(result.best?.fees.grossVenueOutput, sdk.outputAmount.toString());
  assert.equal(result.best?.fees.henarInputFee, "150000");
});

test("build refuses without the execution flag, then without owner/min-out, and never with a stale quote", async () => {
  const market = buildDammV2Market(base);
  const quote = await adapterFor(market).getQuote(buy("1000000"), ctx([registryPool()]));
  const off = await adapterFor(market).buildSwapInstructions(quote, ctx([registryPool()]));
  assert.equal(off.reason, "VENUE_DISABLED");
  const on = new MeteoraDammV2Adapter({ quotesEnabled: true, executionEnabled: true, readMarket: async () => market });
  assert.equal((await on.buildSwapInstructions(quote, ctx([registryPool()]))).reason, "INVALID_REQUEST");
  const expired = await on.buildSwapInstructions(quote, ctx([registryPool()], NOW + 60_000), { owner: "11111111111111111111111111111111", minimumAmountOut: "1" });
  assert.equal(expired.reason, "QUOTE_EXPIRED");
  const noRpc = await on.buildSwapInstructions(quote, ctx([registryPool()]), { owner: "11111111111111111111111111111111", minimumAmountOut: "1" });
  assert.equal(noRpc.reason, "VENUE_NOT_CONFIGURED");
  const tooHigh = await on.buildSwapInstructions(quote, { ...ctx([registryPool()]), connection: {} as never }, { owner: "11111111111111111111111111111111", minimumAmountOut: (BigInt(quote.expectedAmountOut) + 1n).toString() });
  assert.equal(tooHigh.reason, "INVALID_REQUEST");
});
