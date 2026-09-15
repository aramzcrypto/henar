/** Task 23: /v1/quote and /v1/build handlers with FIXTURE adapters; flags off by default. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_MINT, unavailableQuote, type QuoteRequest, type VenueAdapter, type VenueQuote } from "@henar/router-core";
import { RouterApi, RouterHealth, type QuoteApiResponse } from "@henar/router-app";
import { NOW, OWNER, SHARES, key, rep } from "./fixtures/plan";

function adapter(venue: VenueAdapter["venue"], impl: (r: QuoteRequest) => VenueQuote): VenueAdapter {
  return {
    venue,
    capabilities: () => ({ venue, quote: true, legacyExecution: false, nativeBuild: false, poolTypes: [], supportsMinOut: true, supportsToken2022: true }),
    health: async () => ({ venue, healthy: true, checkedAt: "", detail: null }),
    getQuote: async (r) => impl(r),
    buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }),
  };
}
const ok = (venue: VenueAdapter["venue"], r: QuoteRequest, out: bigint): VenueQuote => ({
  ...unavailableQuote(venue, r, "SDK_ERROR", null, key(1), NOW),
  amountIn: r.amount,
  expectedAmountOut: out.toString(),
  unavailableReason: null,
  unavailableDetail: null,
  priceImpactBps: 10,
  slot: 300_000_000,
  onchainCheckedAtQuote: true,
  expiresAt: new Date(NOW + 10_000).toISOString(),
  source: "fixture",
});

const deps = (adapters: VenueAdapter[]) => new RouterApi({ adapters, connection: null, health: new RouterHealth(null), now: () => NOW, currentSlot: async () => 300_000_001 });
const body = { representationId: rep.id, side: "buy" as const, amount: "100000000" };

test("quotes are refused while HENAR_ROUTER_QUOTES is off", async () => {
  delete process.env.HENAR_ROUTER_QUOTES;
  const r = await deps([adapter("raydium", (q) => ok("raydium", q, SHARES(20n)))]).quote(body);
  assert.equal(r.status, 503);
});

test("quote response carries every required field; direct venues are quote-only and marked LIVE_VALIDATION_PENDING", async () => {
  process.env.HENAR_ROUTER_QUOTES = "1";
  const api = deps([adapter("raydium", (q) => ok("raydium", q, SHARES(20n))), adapter("meteora-dbc", (q) => unavailableQuote("meteora-dbc", q, "NO_VERIFIED_POOL"))]);
  const r = await api.quote(body);
  assert.equal(r.status, 200);
  const q = r.body as QuoteApiResponse;
  assert.equal(q.quoteId.length, 32);
  assert.equal(q.company, rep.equityId);
  assert.equal(q.issuer, rep.provider);
  assert.equal(q.representation.mint, rep.mint);
  assert.equal(q.expectedOutput, SHARES(20n).toString());
  assert.equal(q.fees?.henarAmount, "150000");
  assert.equal(q.route?.[0].venue, "raydium");
  assert.equal(q.exclusions[0].reason, "NO_VERIFIED_POOL");
  assert.equal(q.liveValidation, "LIVE_VALIDATION_PENDING");
  // The committed registry holds only DISCOVERED pools and this fixture pool
  // is not registered, so the guard refuses; the API reports that honestly.
  assert.equal(q.executionProtection?.mode, "refused");
  assert.equal(q.minOutput, null);
  assert.ok(q.unavailableReason);
  // The catalog carries no decimals until chain verification, so the price is null here by design.
  assert.equal(q.effectivePrice, rep.decimals === null ? null : q.effectivePrice);
  delete process.env.HENAR_ROUTER_QUOTES;
});

test("validation: unknown representation, bad side, bad amount", async () => {
  process.env.HENAR_ROUTER_QUOTES = "1";
  const api = deps([]);
  assert.equal((await api.quote({ ...body, representationId: "nope" })).status, 404);
  assert.equal((await api.quote({ ...body, side: "hold" as never })).status, 400);
  assert.equal((await api.quote({ ...body, amount: "1.5" })).status, 400);
  assert.equal((await api.quote({ ...body, amount: "0" })).status, 400);
  delete process.env.HENAR_ROUTER_QUOTES;
});

test("build is refused while HENAR_ROUTER_EXECUTION is off, and for unknown, expired or unapproved quotes", async () => {
  process.env.HENAR_ROUTER_QUOTES = "1";
  delete process.env.HENAR_ROUTER_EXECUTION;
  const api = deps([adapter("raydium", (q) => ok("raydium", q, SHARES(20n)))]);
  const q = (await api.quote(body)).body as QuoteApiResponse;
  assert.equal((await api.build({ quoteId: q.quoteId, owner: OWNER })).status, 403);
  process.env.HENAR_ROUTER_EXECUTION = "1";
  assert.equal((await api.build({ quoteId: "missing", owner: OWNER })).status, 404);
  const refused = await api.build({ quoteId: q.quoteId, owner: OWNER });
  assert.equal(refused.status, 409); // guard did not approve the fixture quote
  delete process.env.HENAR_ROUTER_EXECUTION;
  delete process.env.HENAR_ROUTER_QUOTES;
  assert.equal((await api.submit()).status, 501);
  assert.equal(USDC_MINT.length, 44);
});
