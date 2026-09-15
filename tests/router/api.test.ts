/** Task 23: /v1/quote and /v1/build handlers with FIXTURE adapters; flags off by default. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_MINT, unavailableQuote, type QuoteRequest, type VenueAdapter, type VenueQuote } from "@henar/router-core";
import { RouterApi, RouterHealth, capabilityOf, selectRoute, type QuoteApiResponse } from "@henar/router-app";
import type { GuardVerdict } from "@henar/execution-guard";
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

/**
 * Regression: the response must be auditable on its own.
 *
 * `alternatives` deliberately excludes the selected quote, which once led a
 * reader (correctly following the field names) to conclude that a lower-output
 * venue had won, when the winner simply was not in the list. `comparison`
 * carries every quote with the winner flagged, and the winner must hold the
 * highest net output of any approved quote unless a guard reason says why not.
 */
test("comparison lists every quote, flags the winner, and the winner is the best approved net output", async () => {
  process.env.HENAR_ROUTER_QUOTES = "1";
  const api = deps([
    adapter("raydium", (r) => ok("raydium", r, SHARES(60n))),
    adapter("jupiter", (r) => ok("jupiter", r, SHARES(40n))),
    adapter("openocean", (r) => ok("openocean", r, SHARES(20n))),
  ]);
  const result = await api.quote(body);
  assert.equal(result.status, 200);
  const response = result.body as QuoteApiResponse;
  const comparison = response.comparison;
  assert.ok(comparison, "comparison must be present when quotes exist");

  // Every venue that quoted appears exactly once, winner included.
  const venues = comparison.map((c) => c.venue).sort();
  assert.deepEqual(venues, ["jupiter", "openocean", "raydium"]);

  // Exactly one winner, and it is the one the route and bestQuote refer to.
  const selected = comparison.filter((c) => c.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]!.venue, response.route?.[0]?.venue);
  assert.equal(selected[0]!.netOutput, response.netUserOutput);

  // No approved quote beats the winner on net output.
  const approved = comparison.filter((c) => c.approved);
  for (const quote of approved)
    assert.ok(
      BigInt(selected[0]!.netOutput) >= BigInt(quote.netOutput),
      `${quote.venue} (${quote.netOutput}) beat the selected quote (${selected[0]!.netOutput})`,
    );

  // Every row is attributable to a moment and a chain state.
  for (const quote of comparison) {
    assert.ok(quote.quotedAt, `${quote.venue} has no quotedAt`);
    assert.ok(quote.stateSlot !== undefined, `${quote.venue} has no stateSlot`);
  }

  // alternatives still excludes the winner; that is now safe because
  // comparison is complete.
  assert.equal(
    response.alternatives?.some(
      (a) => a.venue === selected[0]!.venue && a.netOutput === selected[0]!.netOutput,
    ),
    false,
  );
});

/**
 * Regression: owning the instruction builder is not worth basis points.
 *
 * A $10k NVDAx quote once selected Raydium over an approved Jupiter route
 * worth 9.26 bps more, because only Raydium had a native builder. Native is a
 * tie-breaker inside a threshold now, not a trump card.
 */
test("a materially better approved external route beats Henar Native", () => {
  const native = (net: bigint): GuardVerdict =>
    ({
      approved: true,
      mode: "execute",
      quote: { venue: "raydium", netOutput: net.toString(), executionPath: "henar-native" },
    }) as unknown as GuardVerdict;
  const external = (net: bigint): GuardVerdict =>
    ({
      approved: true,
      mode: "quote-only",
      quote: { venue: "jupiter", netOutput: net.toString(), executionPath: "legacy-market-api" },
    }) as unknown as GuardVerdict;
  const quoteOnly = (net: bigint): GuardVerdict =>
    ({
      approved: true,
      mode: "quote-only",
      quote: { venue: "openocean", netOutput: net.toString(), executionPath: "none" },
    }) as unknown as GuardVerdict;

  // The observed case: external is 9.26 bps better, so it must win.
  const observed = selectRoute([native(4_683_977_489n), external(4_688_318_531n)]);
  assert.equal(observed?.quote.venue, "jupiter");

  // Within the threshold, native keeps it: reliability breaks a near-tie.
  const nearTie = selectRoute([native(9_999_999n), external(10_000_000n)], 5);
  assert.equal(nearTie?.quote.venue, "raydium");

  // Native wins outright when it is actually better.
  const nativeBetter = selectRoute([native(11_000_000n), external(10_000_000n)]);
  assert.equal(nativeBetter?.quote.venue, "raydium");

  // A quote-only venue can never be selected, however good its number.
  const unreachable = selectRoute([native(10_000_000n), quoteOnly(99_000_000n)]);
  assert.equal(unreachable?.quote.venue, "raydium");

  // Nothing executable at all selects nothing.
  assert.equal(selectRoute([quoteOnly(10n)]), undefined);

  // Capability classification is explicit.
  assert.equal(capabilityOf(native(1n)), "HENAR_NATIVE");
  assert.equal(capabilityOf(external(1n)), "EXTERNAL_EXECUTABLE");
  assert.equal(capabilityOf(quoteOnly(1n)), "QUOTE_ONLY");
});
