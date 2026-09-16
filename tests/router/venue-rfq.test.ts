/** RFQ adapter on a FAKE transport: firm-quote validation, refusals, and ranking as quote-only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_MINT, listRouterRepresentations, quoteRepresentation, type QuoteRequest } from "@henar/router-core";
import { RfqAdapter, parseFirmQuote } from "@henar/venue-rfq";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const NOW = 1_800_000_000_000;
const buy = (amount = "100000000"): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint, wallet: null });
const wire = (over: Record<string, unknown> = {}) => ({
  maker: "maker-a", inputMint: USDC_MINT, outputMint: rep.mint, amountIn: "99900000", amountOut: "1234567", expiresAt: new Date(NOW + 5_000).toISOString(), nonce: "n1", signature: "sig", settlementType: "maker-program", transaction: null, ...over,
});

test("parseFirmQuote accepts a complete, matching, unexpired firm quote and refuses anything else", () => {
  const req = { ...buy(), amount: "99900000" };
  const ok = parseFirmQuote(wire(), req, NOW);
  assert.ok("quote" in ok);
  assert.equal(ok.quote.output, "1234567");
  assert.equal(ok.quote.maker, "maker-a");
  for (const [bad, pattern] of [
    [wire({ amountIn: "1" }), /amount differs/],
    [wire({ outputMint: USDC_MINT }), /pair differs/],
    [wire({ expiresAt: new Date(NOW - 1).toISOString() }), /expired/],
    [wire({ signature: "" }), /signature/],
    [wire({ nonce: undefined }), /nonce/],
    [wire({ amountOut: "-5" }), /amountOut/],
    [null, /not an object/],
  ] as const) {
    const r = parseFirmQuote(bad, req, NOW);
    assert.ok("problem" in r);
    assert.match(r.problem, pattern);
  }
});

test("without a URL the adapter is not configured; with a fake transport it quotes firm, quote-only, with zero impact", async () => {
  const unconfigured = new RfqAdapter({ url: null });
  const none = await unconfigured.getQuote(buy(), { connection: null, pools: [], now: NOW, deadlineMs: 1000 });
  assert.equal(none.unavailableReason, "VENUE_NOT_CONFIGURED");

  const calls: unknown[] = [];
  const adapter = new RfqAdapter({ transport: async (body) => { calls.push(body); return { ok: true, status: 200, json: wire({ amountIn: body.amount }) }; }, label: "maker-a" });
  const q = await adapter.getQuote({ ...buy(), amount: "99900000" }, { connection: null, pools: [], now: NOW, deadlineMs: 1000 });
  assert.equal(q.unavailableReason, null);
  assert.equal(q.expectedAmountOut, "1234567");
  assert.equal(q.minimumAmountOut, "1234567");
  assert.equal(q.priceImpactBps, 0);
  assert.equal(q.executionPath, "none");
  assert.equal(calls.length, 1);
  const firm = await adapter.requestFirmQuote({ ...buy(), amount: "99900000" });
  assert.equal(firm?.nonce, "n1");
});

test("maker errors map to structured reasons: 429 → RATE_LIMIT_RETRY, 500 → VENUE_UNHEALTHY, drift → QUOTE_TERMS_MISMATCH, abort → VENUE_TIMEOUT", async () => {
  const ctx = { connection: null, pools: [], now: NOW, deadlineMs: 1000 };
  const req = { ...buy(), amount: "99900000" };
  const with_ = (r: { ok: boolean; status: number; json: unknown }) => new RfqAdapter({ transport: async () => r });
  assert.equal((await with_({ ok: false, status: 429, json: null }).getQuote(req, ctx)).unavailableReason, "RATE_LIMIT_RETRY");
  assert.equal((await with_({ ok: false, status: 500, json: null }).getQuote(req, ctx)).unavailableReason, "VENUE_UNHEALTHY");
  assert.equal((await with_({ ok: true, status: 200, json: wire({ amountIn: "5" }) }).getQuote(req, ctx)).unavailableReason, "QUOTE_TERMS_MISMATCH");
  const aborted = new RfqAdapter({ transport: async () => { throw new Error("The operation was aborted"); } });
  assert.equal((await aborted.getQuote(req, ctx)).unavailableReason, "VENUE_TIMEOUT");
});

test("in the engine an RFQ firm quote is ranked against the others and the Henar fee is applied once", async () => {
  process.env.HENAR_ROUTER_QUOTES = "1";
  const adapter = new RfqAdapter({ transport: async (body) => ({ ok: true, status: 200, json: wire({ amountIn: body.amount }) }) });
  const result = await quoteRepresentation(buy(), { adapters: [adapter], enabled: true, splitRouting: false, poolsOverride: [] });
  assert.equal(result.best?.venue, "rfq");
  assert.equal(result.best?.fees.henarInputFee, "100000");
  assert.equal(result.best?.fees.venueInput, "99900000");
  assert.equal(result.best?.netOutput, "1234567");
});
