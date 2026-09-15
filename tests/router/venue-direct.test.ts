/**
 * Direct venue adapters without RPC. The SDK paths need chain state, so a
 * real quote is only exercised when SOLANA_RPC_URL is set; what is always
 * tested is that each adapter fails closed with the right reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection } from "@solana/web3.js";
import {
  USDC_MINT,
  listRouterRepresentations,
  loadPoolRegistry,
  poolsForRepresentation,
  type QuoteContext,
  type QuoteRequest,
} from "@henar/router-core";
import { RaydiumAdapter } from "@henar/venue-raydium";
import { MeteoraAdapter } from "@henar/venue-meteora";

const registry = loadPoolRegistry();
const withPool = registry.pools.find((p) => p.enabled && p.venue === "raydium");
const rep = listRouterRepresentations().find((r) => r.id === withPool?.representationId) ?? listRouterRepresentations()[0];

const request: QuoteRequest = {
  representationId: rep.id,
  side: "buy",
  amount: "99850000",
  amountType: "input",
  inputMint: USDC_MINT,
  outputMint: rep.mint,
};

function ctx(overrides: Partial<QuoteContext> = {}): QuoteContext {
  return { connection: null, pools: [], now: Date.now(), deadlineMs: 5000, ...overrides };
}

test("raydium: no enabled pool → NO_VERIFIED_POOL; pool but no RPC → VENUE_NOT_CONFIGURED", async () => {
  const adapter = new RaydiumAdapter();
  const none = await adapter.getQuote(request, ctx());
  assert.equal(none.unavailableReason, "NO_VERIFIED_POOL");
  if (withPool) {
    const noRpc = await adapter.getQuote(request, ctx({ pools: poolsForRepresentation(rep.id, { venue: "raydium" }) }));
    assert.equal(noRpc.unavailableReason, "VENUE_NOT_CONFIGURED");
    assert.equal(noRpc.poolAddress, poolsForRepresentation(rep.id, { venue: "raydium" })[0]?.address);
  }
});

test("meteora: no enabled DLMM pool → NO_VERIFIED_POOL", async () => {
  const adapter = new MeteoraAdapter();
  const none = await adapter.getQuote(request, ctx());
  assert.equal(none.unavailableReason, "NO_VERIFIED_POOL");
  const wrongVenue = await adapter.getQuote(request, ctx({ pools: poolsForRepresentation(rep.id, { venue: "raydium" }) }));
  assert.equal(wrongVenue.unavailableReason, "NO_VERIFIED_POOL");
});

test("adapters never quote exact-out", async () => {
  for (const adapter of [new RaydiumAdapter(), new MeteoraAdapter()]) {
    const q = await adapter.getQuote({ ...request, amountType: "output" }, ctx());
    assert.equal(q.unavailableReason, "NOT_IMPLEMENTED");
  }
});

test(
  "raydium: live CLMM quote via SDK (needs SOLANA_RPC_URL)",
  { skip: !process.env.SOLANA_RPC_URL || !withPool ? "no RPC or no enabled pool" : false },
  async () => {
    const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
    const adapter = new RaydiumAdapter();
    const pools = poolsForRepresentation(rep.id, { venue: "raydium" });
    const quote = await adapter.getQuote(request, ctx({ connection, pools }));
    assert.equal(quote.unavailableReason, null, quote.unavailableDetail ?? "");
    assert.equal(quote.amountIn, request.amount);
    assert.ok(BigInt(quote.expectedAmountOut) > 0n);
    assert.ok(quote.slot && quote.slot > 0);
    assert.equal(quote.source, "raydium-sdk-v2 PoolUtils.computeAmountOutFormat");
  },
);
