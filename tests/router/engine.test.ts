import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USDC_MINT,
  compareRanked,
  listRouterRepresentations,
  quoteRepresentation,
  rankQuote,
  unavailableQuote,
  validateQuoteRequest,
  type QuoteContext,
  type QuoteRequest,
  type VenueAdapter,
  type VenueQuote,
} from "@henar/router-core";
import { MARKET_FEE_BPS, tradeFee } from "@/lib/trade-fee";

/* The policy fee, derived rather than written out: these tests are about fee
   accounting, not about one particular rate. */
const FEE_BPS = MARKET_FEE_BPS;

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;

function buy(amount = "100000000"): QuoteRequest {
  return {
    representationId: rep.id,
    side: "buy",
    amount,
    amountType: "input",
    inputMint: USDC_MINT,
    outputMint: rep.mint,
  };
}

function sell(amount = "100000000"): QuoteRequest {
  return {
    representationId: rep.id,
    side: "sell",
    amount,
    amountType: "input",
    inputMint: rep.mint,
    outputMint: USDC_MINT,
  };
}

function ok(venue: VenueAdapter["venue"], request: QuoteRequest, out: string, extra?: Partial<VenueQuote>): VenueQuote {
  return {
    ...unavailableQuote(venue, request, "SDK_ERROR"),
    expectedAmountOut: out,
    unavailableReason: null,
    unavailableDetail: null,
    source: `${venue}:test`,
    ...extra,
  };
}

function adapter(
  venue: VenueAdapter["venue"],
  impl: (request: QuoteRequest, ctx: QuoteContext) => Promise<VenueQuote> | VenueQuote,
): VenueAdapter {
  return {
    venue,
    capabilities: () => ({ venue, quote: true, legacyExecution: false, nativeBuild: false, poolTypes: [], supportsMinOut: true, supportsToken2022: true }),
    health: async () => ({ venue, healthy: true, checkedAt: "", detail: null }),
    getQuote: async (request, ctx) => impl(request, ctx),
    buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }),
  };
}

test("engine is off unless enabled; every venue is excluded with ROUTER_DISABLED", async () => {
  delete process.env.HENAR_ROUTER_QUOTES;
  const result = await quoteRepresentation(buy(), {
    adapters: [adapter("jupiter", (r) => ok("jupiter", r, "1"))],
  });
  assert.equal(result.enabled, false);
  assert.equal(result.best, null);
  assert.deepEqual(result.exclusions.map((x) => x.reason), ["ROUTER_DISABLED"]);
});

test("buy: fee comes off the USDC input before the venue is asked", async () => {
  let seen: QuoteRequest | null = null;
  const result = await quoteRepresentation(buy("100000000"), {
    enabled: true,
    adapters: [
      adapter("jupiter", (r) => {
        seen = r;
        return ok("jupiter", r, "500000000", { amountIn: r.amount });
      }),
    ],
  });
  // The fee comes off the USDC input, so the venue is asked for the remainder.
  const input = 100_000_000n;
  const fee = tradeFee(input);
  assert.equal(seen!.amount, (input - fee).toString());
  assert.equal(result.best?.henarFeeAmount, fee.toString());
  assert.equal(result.best?.henarFeeMint, USDC_MINT);
  assert.equal(result.best?.swapInput, (input - fee).toString());
  assert.equal(result.best?.netOutput, "500000000");
  assert.deepEqual(result.best?.fees, {
    inputMint: USDC_MINT,
    outputMint: rep.mint,
    userInput: "100000000",
    henarInputFee: fee.toString(),
    venueInput: (input - fee).toString(),
    grossVenueOutput: "500000000",
    venueFee: null,
    venueFeeMint: null,
    henarOutputFee: "0",
    netUserOutput: "500000000",
    henarFeeBps: FEE_BPS,
  });
});

test("sell: venue sees full input, fee comes off USDC output", async () => {
  const result = await quoteRepresentation(sell("100000000"), {
    enabled: true,
    adapters: [adapter("raydium", (r) => ok("raydium", r, "20000000", { amountIn: r.amount }))],
  });
  assert.equal(result.best?.swapInput, "100000000");
  assert.equal(result.best?.henarFeeAmount, tradeFee(20_000_000n).toString()); // fee on the USDC received
  assert.equal(result.best?.henarFeeMint, USDC_MINT);
  assert.equal(result.best?.netOutput, (20_000_000n - tradeFee(20_000_000n)).toString());
  assert.equal(result.best?.fees.henarInputFee, "0");
  assert.equal(result.best?.fees.henarOutputFee, tradeFee(20_000_000n).toString());
  assert.equal(result.best?.fees.venueInput, "100000000");
});

test("fee cannot be charged twice: a venue quoting the user amount on a buy is rejected", () => {
  const request = buy("100000000");
  // Adapter ignored the fee-reduced amount and quoted the full user input.
  assert.throws(() => rankQuote(ok("jupiter", request, "1", { amountIn: "100000000" }), request, FEE_BPS), /fee accounting/);
  // Correct venue input passes and userInput = venueInput + henarInputFee.
  const venueInput = (100_000_000n - tradeFee(100_000_000n)).toString();
  const ranked = rankQuote(ok("jupiter", request, "1", { amountIn: venueInput }), request, FEE_BPS);
  assert.equal(BigInt(ranked.fees.venueInput) + BigInt(ranked.fees.henarInputFee), BigInt(ranked.fees.userInput));
  assert.equal(BigInt(ranked.fees.grossVenueOutput) - BigInt(ranked.fees.henarOutputFee), BigInt(ranked.fees.netUserOutput));
});

test("ranks by net output and keeps losers as alternatives, failures as exclusions", async () => {
  const result = await quoteRepresentation(buy(), {
    enabled: true,
    adapters: [
      adapter("jupiter", (r) => ok("jupiter", r, "100", { amountIn: r.amount })),
      adapter("raydium", (r) => ok("raydium", r, "105", { amountIn: r.amount })),
      adapter("meteora", (r) => unavailableQuote("meteora", r, "NO_VERIFIED_POOL")),
    ],
  });
  assert.equal(result.best?.venue, "raydium");
  assert.deepEqual(result.alternatives.map((q) => q.venue), ["jupiter"]);
  assert.deepEqual(result.exclusions, [
    { venue: "meteora", poolAddress: null, reason: "NO_VERIFIED_POOL", detail: null },
  ]);
});

test("a venue that quotes different terms is excluded, never ranked", async () => {
  const result = await quoteRepresentation(buy(), {
    enabled: true,
    adapters: [
      adapter("jupiter", (r) => ok("jupiter", r, "999999", { amountIn: "1" })),
      adapter("raydium", (r) => ok("raydium", r, "10", { amountIn: r.amount })),
    ],
  });
  assert.equal(result.best?.venue, "raydium");
  assert.equal(result.exclusions[0]?.reason, "QUOTE_TERMS_MISMATCH");
});

test("a slow venue is timed out, not awaited forever; a throwing venue is excluded", async () => {
  const result = await quoteRepresentation(buy(), {
    enabled: true,
    deadlineMs: 30,
    adapters: [
      adapter("jupiter", () => new Promise(() => {})),
      adapter("raydium", () => {
        throw new Error("boom");
      }),
      adapter("meteora", (r) => ok("meteora", r, "10", { amountIn: r.amount })),
    ],
  });
  assert.equal(result.best?.venue, "meteora");
  assert.deepEqual(
    result.exclusions.map((x) => [x.venue, x.reason]).sort(),
    [
      ["jupiter", "VENUE_TIMEOUT"],
      ["raydium", "VENUE_TIMEOUT"],
    ],
  );
});

test("only USDC ↔ verified representation is accepted", () => {
  assert.equal(validateQuoteRequest(buy()).ok, true);
  assert.equal(validateQuoteRequest(sell()).ok, true);
  const wrongMint = validateQuoteRequest({ ...buy(), inputMint: rep.mint });
  assert.equal(wrongMint.ok, false);
  const unknown = validateQuoteRequest({ ...buy(), representationId: "nope" });
  assert.equal(unknown.ok, false);
  const zero = validateQuoteRequest(buy("0"));
  assert.equal(zero.ok, false);
  const float = validateQuoteRequest(buy("1.5"));
  assert.equal(float.ok, false);
  const exactOut = validateQuoteRequest({ ...buy(), amountType: "output" });
  assert.equal(exactOut.ok && "ok", false);
  assert.equal(!exactOut.ok && exactOut.reason, "NOT_IMPLEMENTED");
});

test("rankQuote and compareRanked use integer math and stable tie-breaks", () => {
  const request = sell("1000");
  const a = rankQuote(ok("jupiter", request, "1000000", { amountIn: "1000", priceImpactBps: 5 }), request, FEE_BPS);
  const b = rankQuote(ok("raydium", request, "1000000", { amountIn: "1000", priceImpactBps: 2 }), request, FEE_BPS);
  assert.equal(a.netOutput, (1_000_000n - tradeFee(1_000_000n)).toString());
  assert.equal(compareRanked(a, b) > 0, true); // lower impact wins a tie
  const c = rankQuote(ok("meteora", request, "1000001", { amountIn: "1000" }), request, FEE_BPS);
  assert.equal(compareRanked(c, a) < 0, true); // more net output wins
  const d = rankQuote(ok("jupiter", request, "1000000", { amountIn: "1000", priceImpactBps: 2, executionPath: "legacy-market-api" }), request, FEE_BPS);
  assert.equal(compareRanked(d, b) < 0, true); // reachable path wins a full tie
});
