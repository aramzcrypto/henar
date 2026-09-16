/**
 * The headline quote must be one Henar can actually fill.
 *
 * `/api/market` builds every market swap through Jupiter's build endpoint and
 * nothing else. OpenOcean and Titan are quote-only, and Raydium's legacy
 * adapter says in its own comment that Henar does not mark it executable. The
 * aggregator used to rank purely on output, so a quote-only source could take
 * the ticket's "Receive" line and promise the user an amount the order would
 * never produce. Measured on 16 September 2026, that happened in 4 of 23
 * equity quotes, once by 11.6 bps.
 *
 * Non-fillable sources must still be returned, because showing the user that
 * another venue is better is worth doing. They just cannot be the promise.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { aggregateWithAdapters } from "../src/lib/execution/aggregate";
import { FILLABLE_PROVIDERS, type ExecutionSource, type QuoteProvider, type SourceExecutionQuote } from "../src/lib/execution/types";

const request = { inputMint: "A".repeat(43), outputMint: "B".repeat(43), amount: 1_000_000_000n, slippageBps: 50 };

function quote(source: ExecutionSource, provider: QuoteProvider, out: string): SourceExecutionQuote {
  return {
    source,
    quoteProvider: provider,
    quoteId: null,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inputAmount: String(request.amount),
    grossOutputAmount: out,
    outputAmount: out,
    minimumOutputAmount: out,
    providerFeeBps: 0,
    providerFeeAmount: "0",
    priceImpactPct: "0",
    route: [{ venue: source, pool: null, percent: 100 }],
    contextSlot: null,
    quotedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15_000).toISOString(),
    transactionAvailable: false,
  };
}

const adapters = (rows: [ExecutionSource, QuoteProvider, string][]) =>
  rows.map(([source, provider, out]) => [source, async () => quote(source, provider, out)]) as never;

test("the benchmark-only sources are exactly OpenOcean and Titan", () => {
  /* Jupiter builds through /api/market; Raydium builds natively through the
     Henar Router. Neither OpenOcean nor Titan has a builder anywhere. */
  assert.deepEqual([...FILLABLE_PROVIDERS].sort(), ["jupiter", "raydium"]);
});

test("a quote-only source with the best price does not become the headline", async () => {
  const result = await aggregateWithAdapters(
    request,
    adapters([
      ["jupiter", "jupiter", "1000"],
      ["raydium", "raydium", "900"],
      ["openocean", "openocean", "1200"],
      ["titan", "titan", "1100"],
    ]),
  );
  assert.equal(result.selected?.source, "jupiter", "headline must be fillable");
  assert.equal(result.selected?.outputAmount, "1000");
  // The better quotes are still reported, ranked, so the comparison survives.
  assert.deepEqual(result.candidates.map((c) => c.source), ["openocean", "titan", "jupiter", "raydium"]);
  assert.equal(result.candidates[0].fillable, false);
  assert.equal(result.candidates[1].fillable, false);
  assert.equal(result.candidates[2].fillable, true);
  assert.equal(result.candidates[3].fillable, true);
});

test("the best fillable quote wins when several are fillable", async () => {
  const result = await aggregateWithAdapters(
    request,
    adapters([
      ["jupiter", "jupiter", "1300"],
      ["raydium", "raydium", "1250"],
      ["openocean", "openocean", "1200"],
    ]),
  );
  assert.equal(result.selected?.source, "jupiter");
  assert.equal(result.selected?.outputAmount, "1300");
});

test("no fillable quote means no headline, not someone else's number", async () => {
  /* "Unavailable" is a valid product result; a price the user cannot get is
     not. The caller turns a null selection into "no route available". */
  const result = await aggregateWithAdapters(
    request,
    adapters([
      ["openocean", "openocean", "1200"],
      ["titan", "titan", "1100"],
    ]),
  );
  assert.equal(result.selected, null);
  assert.equal(result.candidates.length, 2);
});
