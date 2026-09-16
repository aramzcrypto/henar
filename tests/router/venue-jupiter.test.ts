import { test } from "node:test";
import assert from "node:assert/strict";
import { JupiterAdapter } from "@henar/venue-jupiter";
import { USDC_MINT, listRouterRepresentations, type QuoteContext, type QuoteRequest } from "@henar/router-core";
import type { NormalizedExecutionQuote } from "@/lib/execution/types";

const rep = listRouterRepresentations()[0];
const ctx: QuoteContext = { connection: null, pools: [], now: 1_800_000_000_000, deadlineMs: 1000 };
const request: QuoteRequest = {
  representationId: rep.id,
  side: "buy",
  amount: "99850000",
  amountType: "input",
  inputMint: USDC_MINT,
  outputMint: rep.mint,
};

function normalized(overrides: Partial<NormalizedExecutionQuote> = {}): NormalizedExecutionQuote {
  return {
    fillable: true,
    source: "jupiter",
    quoteProvider: "jupiter",
    quoteId: null,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inputAmount: request.amount,
    grossOutputAmount: "500000000",
    outputAmount: "500000000",
    minimumOutputAmount: "497500000",
    providerFeeBps: 0,
    providerFeeAmount: "0",
    priceImpactPct: "0.0012",
    route: [{ venue: "Raydium CLMM", pool: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6", percent: 100 }],
    contextSlot: 123,
    quotedAt: "",
    expiresAt: "",
    transactionAvailable: false,
    ...overrides,
  };
}

test("without JUPITER_API_KEY the adapter reports VENUE_NOT_CONFIGURED and never calls out", async () => {
  delete process.env.JUPITER_API_KEY;
  let called = false;
  const adapter = new JupiterAdapter(async () => {
    called = true;
    return normalized();
  });
  const quote = await adapter.getQuote(request, ctx);
  assert.equal(quote.unavailableReason, "VENUE_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("maps a normalized Jupiter quote into the router model with raw amounts", async () => {
  process.env.JUPITER_API_KEY = "test";
  const adapter = new JupiterAdapter(async () => normalized());
  const quote = await adapter.getQuote(request, ctx);
  assert.equal(quote.unavailableReason, null);
  assert.equal(quote.amountIn, "99850000");
  assert.equal(quote.expectedAmountOut, "500000000");
  assert.equal(quote.minimumAmountOut, "497500000");
  assert.equal(quote.priceImpactBps, 12);
  assert.equal(quote.slot, 123);
  assert.equal(quote.poolAddress, "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6");
  assert.equal(quote.executionPath, "legacy-market-api");
  assert.equal(quote.onchainCheckedAtQuote, false);
  const caps = adapter.capabilities();
  assert.equal(caps.legacyExecution, true);
  assert.equal(caps.nativeBuild, false);
  assert.equal((await adapter.buildSwapInstructions()).reason, "NOT_IMPLEMENTED");
  assert.equal(quote.quotedAt, new Date(ctx.now).toISOString());
  delete process.env.JUPITER_API_KEY;
});

test("a drifted response is QUOTE_TERMS_MISMATCH; a thrown error is a structured reason", async () => {
  process.env.JUPITER_API_KEY = "test";
  const drift = new JupiterAdapter(async () => normalized({ inputAmount: "1" }));
  assert.equal((await drift.getQuote(request, ctx)).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const thrown = new JupiterAdapter(async () => {
    throw new Error("Jupiter quote terms did not match the request.");
  });
  assert.equal((await thrown.getQuote(request, ctx)).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const down = new JupiterAdapter(async () => {
    throw new Error("No route from Jupiter.");
  });
  assert.equal((await down.getQuote(request, ctx)).unavailableReason, "VENUE_UNHEALTHY");
  const exactOut = await new JupiterAdapter(async () => normalized()).getQuote({ ...request, amountType: "output" }, ctx);
  assert.equal(exactOut.unavailableReason, "NOT_IMPLEMENTED");
  delete process.env.JUPITER_API_KEY;
});
