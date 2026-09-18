/**
 * The executability invariant.
 *
 * Henar must never present an executable quote, split or path containing a leg
 * it cannot build and simulate. A venue that prices a trade it cannot build is
 * not a route, it is a number: it wins the ranking, is shown as Henar's price,
 * and fails at build time.
 *
 * These are regression tests for a defect that was live: `nativeBuild` was
 * declared by all nine adapters and read by nothing, so Meteora DLMM (85
 * enabled pools) and Byreal (19) could be allocated split legs and quoted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  USDC_MINT,
  constantProductCurve,
  executableAsNativeLeg,
  listRouterRepresentations,
  quoteRepresentation,
  unavailableQuote,
  type QuoteContext,
  type QuoteRequest,
  type Venue,
  type VenueAdapter,
  type VenueCurve,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const buy = (amount: string): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint });

const pool = (venue: Venue, address: string, poolType: VerifiedPool["poolType"]): VerifiedPool => ({
  id: address, representationId: rep.id, mint: rep.mint, provider: rep.provider, tokenSymbol: rep.tokenSymbol,
  venue, address, programId: key(50), poolType, baseMint: rep.mint, quoteMint: USDC_MINT, feeBps: 10,
  feeConfig: null, observedTokenPrograms: null, tvlUsd: 1e6, discoveredFrom: "f", discoveredAt: "", verifiedAt: "",
  verification: "ONCHAIN_VERIFIED", onchainVerifiedAt: "x", verificationDetail: null, eligibility: "ROUTER_ELIGIBLE",
  dbc: null, enabled: true, disabledReason: null,
});

function quoteFrom(venue: Venue, curve: VenueCurve, request: QuoteRequest, amountIn: bigint): VenueQuote {
  const out = curve.outputFor(amountIn);
  const base = unavailableQuote(venue, request, "INSUFFICIENT_LIQUIDITY", null, curve.poolAddress);
  if (out === null) return base;
  return { ...base, amountIn: amountIn.toString(), expectedAmountOut: out.toString(), unavailableReason: null, unavailableDetail: null, slot: 1, priceImpactBps: 5, onchainCheckedAtQuote: true, source: "fixture" };
}

/** A venue bound to one pool, buildable or not as declared. */
function venueAdapter(venue: Venue, poolType: VerifiedPool["poolType"], address: string, curve: VenueCurve, nativeBuild: boolean): VenueAdapter {
  return {
    venue,
    capabilities: () => ({ venue, quote: true, legacyExecution: false, nativeBuild, poolTypes: [poolType], supportsMinOut: true, supportsToken2022: true }),
    health: async () => ({ venue, healthy: true, checkedAt: "", detail: null }),
    getQuote: async (r: QuoteRequest, ctx: QuoteContext) =>
      ctx.pools.some((p) => p.address === address) ? quoteFrom(venue, curve, r, BigInt(r.amount)) : unavailableQuote(venue, r, "NO_VERIFIED_POOL"),
    curve: async (r, p) => (p.address === address ? { ...curve, quoteFor: (amt: bigint) => quoteFrom(venue, curve, r, amt) } : null),
    buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }),
  };
}

test("a quote-only venue is kept out of best and alternatives, and reported as a diagnostic", async () => {
  /* The unbuildable venue is deliberately the *better* price, which is the
     case that matters: the defect only ever showed up when the venue Henar
     could not build was the one worth choosing. */
  const buildable = venueAdapter("raydium", "clmm", key(1), constantProductCurve("raydium", key(1), 1_000_000_000n, 200_000_000n, 10), true);
  const quoteOnly = venueAdapter("byreal", "byreal_clmm", key(2), constantProductCurve("byreal", key(2), 1_000_000_000n, 400_000_000n, 10), false);
  const pools = [pool("raydium", key(1), "clmm"), pool("byreal", key(2), "byreal_clmm")];
  const result = await quoteRepresentation(buy("100000000"), { adapters: [buildable, quoteOnly], enabled: true, splitRouting: false, pathRouting: false, poolsOverride: pools });

  assert.equal(result.best?.venue, "raydium", "the buildable venue must win even though byreal priced better");
  assert.ok(!result.alternatives.some((q) => q.venue === "byreal"));
  assert.ok(result.diagnostics.some((q) => q.venue === "byreal"), "the quote is kept for benchmarks");
  assert.ok(
    result.exclusions.some((e) => e.venue === "byreal" && e.reason === "VENUE_NOT_EXECUTABLE"),
    "the exclusion says why, so a production response can answer it",
  );
  // The diagnostic really was the better price: this test would pass vacuously otherwise.
  const shown = BigInt(result.best!.netOutput);
  const hidden = BigInt(result.diagnostics.find((q) => q.venue === "byreal")!.netOutput);
  assert.ok(hidden > shown, "fixture must keep the unbuildable venue strictly better");
});

test("a split never allocates a leg to a venue that cannot build", async () => {
  const buildableA = venueAdapter("raydium", "clmm", key(1), constantProductCurve("raydium", key(1), 1_000_000_000n, 200_000_000n, 10), true);
  const quoteOnly = venueAdapter("meteora", "dlmm", key(3), constantProductCurve("meteora", key(3), 1_000_000_000n, 200_000_000n, 10), false);
  const pools = [pool("raydium", key(1), "clmm"), pool("meteora", key(3), "dlmm")];
  const result = await quoteRepresentation(buy("500000000"), { adapters: [buildableA, quoteOnly], enabled: true, splitRouting: true, pathRouting: false, poolsOverride: pools });

  /* Two equal pools across two venues would split and beat either alone. With
     one of them unbuildable there is only one curve left, so no split exists —
     and that is the correct outcome, not a regression. */
  assert.equal(result.route, null, "no split may be built from an unbuildable leg");
  /* The unbuildable venue is dropped before ranking, so the split stage never
     sees a second candidate at all — a stronger outcome than filtering its
     curve later, and the reason says so. */
  assert.match(result.splitReason ?? "", /nothing to split across|curve/);
  assert.ok(!result.alternatives.some((q) => q.venue === "meteora"));
});

test("a split across two buildable venues is still produced", async () => {
  // Guards the test above from passing because splitting broke generally.
  const a = venueAdapter("raydium", "clmm", key(1), constantProductCurve("raydium", key(1), 1_000_000_000n, 200_000_000n, 10), true);
  const b = venueAdapter("orca", "whirlpool", key(4), constantProductCurve("orca", key(4), 1_000_000_000n, 200_000_000n, 10), true);
  const pools = [pool("raydium", key(1), "clmm"), pool("orca", key(4), "whirlpool")];
  const result = await quoteRepresentation(buy("500000000"), { adapters: [a, b], enabled: true, splitRouting: true, pathRouting: false, poolsOverride: pools });
  assert.ok(result.route, "two buildable venues must still split");
  assert.equal(result.route.legs.length, 2);
  for (const leg of result.route.legs) assert.ok(["raydium", "orca"].includes(leg.venue));
});

test("executableAsNativeLeg requires both quote and nativeBuild", () => {
  const caps = (quote: boolean, nativeBuild: boolean) => ({ venue: "raydium" as Venue, quote, nativeBuild, legacyExecution: false, poolTypes: ["clmm" as const], supportsMinOut: true, supportsToken2022: true });
  assert.equal(executableAsNativeLeg(caps(true, true)), true);
  assert.equal(executableAsNativeLeg(caps(true, false)), false);
  assert.equal(executableAsNativeLeg(caps(false, true)), false);
  // legacyExecution is an aggregator's path and never makes a native leg executable.
  assert.equal(executableAsNativeLeg({ ...caps(true, false), legacyExecution: true }), false);
});
