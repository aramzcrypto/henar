/**
 * Pyth Fair Value inside the Execution Guard: observe/warn never refuse,
 * enforce refuses only a deviation or low-quality reference, a missing
 * reference is reported as unavailable (never as a pass), and the finding
 * rides along on the API response.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPoolRegistry, unavailableQuote, type QuoteRequest, type VenueAdapter, type VenueQuote } from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardQuote, type PythGuardInput } from "@henar/execution-guard";
import { RouterApi, RouterHealth, type QuoteApiResponse } from "@henar/router-app";
import { DEC, NOW, SHARES, SLOT, buy, key, pool, quoteFor, rep } from "./fixtures/plan";
import type { PythReference } from "@/lib/pyth/types";

const ref = (price: string, o: Partial<PythReference> = {}): PythReference => ({
  feedId: 1, symbol: "Crypto.TESTX/USD", price, exponent: -8, confidence: "0.01", confidenceBps: 1, emaPrice: null, emaConfidenceBps: null, publisherCount: 10, marketSession: "regular",
  feedUpdateTimestampUs: String(BigInt(NOW - 1000) * 1000n), feedUpdatedAt: new Date(NOW - 1000).toISOString(), observedAt: new Date(NOW).toISOString(), channel: "fixed_rate@200ms", freshness: "live", ageMs: 1000,
  provenance: { source: "Pyth Pro", provider: "pyth", sourceType: "oracle", observedAt: new Date(NOW).toISOString() }, ...o,
});
const pools = [pool("raydium", key(1))];
const registry = buildPoolRegistry(pools);
// 100 USDC − fee → 20 shares: venue price ≈ 4.995 USDC per share.
const q = () => quoteFor("raydium", buy(), SHARES(20n), key(1));
const ctx = (pyth: PythGuardInput | null) => ({ now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry, pyth });
const pythChecks = (v: ReturnType<typeof guardQuote>) => v.checks.filter((c) => c.name.startsWith("pyth."));

test("no Pyth input: no pyth checks, verdict.pyth is null, existing rules alone decide", () => {
  const v = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx(null));
  assert.equal(v.approved, true);
  assert.equal(v.pyth, null);
  assert.equal(pythChecks(v).length, 0);
});

test("observe mode: a large deviation is recorded, never refused; the state names it", () => {
  const input: PythGuardInput = { references: { underlying: null, token: ref("5.30"), redemptionRate: null }, mode: "observe" };
  const v = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx(input));
  assert.equal(v.approved, true);
  assert.equal(v.pyth?.state, "PYTH_EXECUTION_DEVIATION");
  assert.ok(pythChecks(v).every((c) => c.ok));
  assert.match(pythChecks(v).find((c) => c.name === "pyth.executionDeviation")!.detail, /^observe: route vs token reference -\d+ bps/);
  assert.equal(v.pyth?.assessment?.executableRoutePrice?.side, "buy");
});

test("enforce mode: deviation and low quality refuse with their own reason codes; a small deviation passes", () => {
  const far = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx({ references: { underlying: null, token: ref("5.30"), redemptionRate: null }, mode: "enforce" }));
  assert.equal(far.approved, false);
  assert.equal(far.reason, "PRICE_DEVIATION_TOO_HIGH");
  const low = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx({ references: { underlying: null, token: ref("5.00", { publisherCount: 1 }), redemptionRate: null }, mode: "enforce" }));
  assert.equal(low.approved, false);
  assert.equal(low.reason, "REFERENCE_LOW_QUALITY");
  const near = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx({ references: { underlying: ref("5.00", { symbol: "Equity.US.TEST/USD" }), token: ref("5.00"), redemptionRate: ref("1") }, mode: "enforce" }));
  assert.equal(near.approved, true);
  assert.equal(near.pyth?.state, "PYTH_PASS");
  assert.equal(near.pyth?.assessment?.tokenVsUnderlyingBps, 0);
});

test("missing or stale references never refuse in any mode and are never reported as a pass", () => {
  for (const mode of ["observe", "warn", "enforce"] as const) {
    const none = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx({ references: { underlying: null, token: null, redemptionRate: null }, mode }));
    assert.equal(none.approved, true);
    assert.equal(none.pyth?.state, "PYTH_REFERENCE_UNAVAILABLE");
    const stale = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx({ references: { underlying: null, token: ref("5.00", { freshness: "stale", ageMs: 10 * 60_000 }), redemptionRate: null }, mode }));
    assert.equal(stale.approved, true);
    assert.equal(stale.pyth?.state, "PYTH_STALE");
  }
});

test("closed underlying with a fresh tokenized reference uses the token as the boundary", () => {
  const closed = ref("4.00", { symbol: "Equity.US.TEST/USD", marketSession: "closed", freshness: "carried-forward", ageMs: 5 * 3_600_000 });
  const v = guardQuote(q(), DEFAULT_EXECUTION_POLICY, ctx({ references: { underlying: closed, token: ref("5.00"), redemptionRate: null }, mode: "enforce" }));
  assert.equal(v.approved, true);
  assert.equal(v.pyth?.assessment?.executionReference, "tokenized");
  assert.equal(v.pyth?.assessment?.underlyingMarketSession, "closed");
});

test("path legs skip Pyth (the leg is not priced in USDC per share)", () => {
  const v = guardQuote(q(), DEFAULT_EXECUTION_POLICY, { ...ctx({ references: { underlying: null, token: ref("5.00"), redemptionRate: null }, mode: "enforce" }), pathLeg: { intermediate: key(7), hop: "representation" } });
  assert.equal(v.pyth, null);
});

function adapter(venue: VenueAdapter["venue"], impl: (r: QuoteRequest) => VenueQuote): VenueAdapter {
  return { venue, capabilities: () => ({ venue, quote: true, legacyExecution: false, nativeBuild: false, poolTypes: [], supportsMinOut: true, supportsToken2022: true }), health: async () => ({ venue, healthy: true, checkedAt: "", detail: null }), getQuote: async (r) => impl(r), buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }) };
}

test("RouterApi carries the Pyth finding on the response and survives a failing Pyth provider", async () => {
  process.env.HENAR_ROUTER_QUOTES = "1";
  const ok = (r: QuoteRequest): VenueQuote => ({ ...unavailableQuote("raydium", r, "SDK_ERROR", null, key(1), NOW), amountIn: r.amount, expectedAmountOut: SHARES(20n).toString(), unavailableReason: null, unavailableDetail: null, priceImpactBps: 10, slot: SLOT, onchainCheckedAtQuote: true, expiresAt: new Date(NOW + 10_000).toISOString(), source: "fixture" });
  const api = new RouterApi({ adapters: [adapter("raydium", ok)], connection: null, health: new RouterHealth(null), now: () => NOW, currentSlot: async () => SLOT + 1, pyth: async () => ({ references: { underlying: null, token: ref("5.00"), redemptionRate: null }, mode: "warn" }) });
  const r = (await api.quote({ representationId: rep.id, side: "buy", amount: "100000000" })).body as QuoteApiResponse;
  assert.equal(r.pythFairValue?.mode, "warn");
  assert.ok(r.pythFairValue?.state);
  assert.ok(r.executionProtection?.checks.some((c) => c.name === "pyth.reference"));
  const failing = new RouterApi({ adapters: [adapter("raydium", ok)], connection: null, health: new RouterHealth(null), now: () => NOW, currentSlot: async () => SLOT + 1, pyth: async () => { throw new Error("pyth down"); } });
  const r2 = await failing.quote({ representationId: rep.id, side: "buy", amount: "100000000" });
  assert.equal(r2.status, 200);
  assert.equal((r2.body as QuoteApiResponse).pythFairValue, null);
  delete process.env.HENAR_ROUTER_QUOTES;
});
