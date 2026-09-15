import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonlFileSink,
  MemorySink,
  MultiSink,
  USDC_MINT,
  benchmarkRecord,
  listRouterRepresentations,
  quoteRepresentation,
  summarizeBenchmarks,
  unavailableQuote,
  type QuoteRequest,
  type VenueAdapter,
  type VenueQuote,
} from "@henar/router-core";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const buy = (amount = "100000000"): QuoteRequest => ({
  representationId: rep.id,
  side: "buy",
  amount,
  amountType: "input",
  inputMint: USDC_MINT,
  outputMint: rep.mint,
});

function ok(venue: VenueAdapter["venue"], request: QuoteRequest, out: string, extra: Partial<VenueQuote> = {}): VenueQuote {
  return { ...unavailableQuote(venue, request, "SDK_ERROR"), amountIn: request.amount, expectedAmountOut: out, unavailableReason: null, unavailableDetail: null, source: `${venue}:test`, ...extra };
}

function adapter(venue: VenueAdapter["venue"], impl: (r: QuoteRequest) => VenueQuote): VenueAdapter {
  return {
    venue,
    capabilities: () => ({ venue, quote: true, legacyExecution: false, nativeBuild: false, poolTypes: [], supportsMinOut: true, supportsToken2022: true }),
    health: async () => ({ venue, healthy: true, checkedAt: "", detail: null }),
    getQuote: async (r) => impl(r),
    buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }),
  };
}

test("engine records one benchmark record per result with per-venue outcomes and the Jupiter delta", async () => {
  const sink = new MemorySink();
  const result = await quoteRepresentation(buy(), {
    enabled: true,
    telemetry: sink,
    telemetryTags: { run: "t" },
    adapters: [
      adapter("jupiter", (r) => ok("jupiter", r, "1000000", { executionPath: "legacy-market-api" })),
      adapter("raydium", (r) => ok("raydium", r, "1005000", { priceImpactBps: 3, slot: 10 })),
      adapter("meteora-dbc", (r) => unavailableQuote("meteora-dbc", r, "NO_VERIFIED_POOL")),
    ],
  });
  assert.equal(result.best?.venue, "raydium");
  assert.equal(sink.records.length, 1);
  const rec = sink.records[0];
  assert.equal(rec.schema, "henar.router.benchmark.v1");
  assert.equal(rec.bestVenue, "raydium");
  assert.equal(rec.bestDirectVenue, "raydium");
  assert.equal(rec.jupiterNetOutput, "1000000");
  assert.equal(rec.directVsJupiterBps, 50); // 0.5% better
  assert.equal(rec.tags.run, "t");
  assert.deepEqual(
    rec.venues.map((v) => [v.venue, v.available, v.reason]),
    [
      ["raydium", true, null],
      ["jupiter", true, null],
      ["meteora-dbc", false, "NO_VERIFIED_POOL"],
    ],
  );
  const ray = rec.venues.find((v) => v.venue === "raydium")!;
  assert.equal(ray.netUserOutput, "1005000");
  assert.equal(ray.grossVenueOutput, "1005000");
  assert.equal(ray.priceImpactBps, 3);
  assert.equal(typeof ray.latencyMs, "number");
});

test("a failing sink never fails the quote", async () => {
  const boom = { record: async () => { throw new Error("disk full"); } };
  const result = await quoteRepresentation(buy(), { enabled: true, telemetry: boom, adapters: [adapter("jupiter", (r) => ok("jupiter", r, "1"))] });
  assert.equal(result.best?.venue, "jupiter");
});

test("disabled router and all-excluded results still produce records with null comparisons", async () => {
  const sink = new MemorySink();
  delete process.env.HENAR_ROUTER_QUOTES;
  await quoteRepresentation(buy(), { telemetry: sink, adapters: [adapter("jupiter", (r) => ok("jupiter", r, "1"))] });
  await quoteRepresentation(buy(), { enabled: true, telemetry: sink, adapters: [adapter("jupiter", (r) => unavailableQuote("jupiter", r, "VENUE_NOT_CONFIGURED"))] });
  assert.equal(sink.records.length, 2);
  assert.equal(sink.records[0].enabled, false);
  assert.equal(sink.records[0].venues[0].reason, "ROUTER_DISABLED");
  assert.equal(sink.records[1].bestVenue, null);
  assert.equal(sink.records[1].directVsJupiterBps, null);
});

test("summary computes win rate, median delta, availability and latency percentiles", () => {
  const base = benchmarkRecord({ enabled: true, request: buy(), best: null, alternatives: [], route: null,
      splitReason: null, exclusions: [], quotedAt: "", slot: null, latencyMs: {} });
  const recs = [10, -20, 30, 0, 5].map((d, i) => ({
    ...base,
    bestVenue: d > 0 ? ("raydium" as const) : ("jupiter" as const),
    directVsJupiterBps: d,
    venues: [
      { ...base.venues[0], venue: "raydium" as const, available: true, reason: null, latencyMs: 100 + i * 10, poolAddress: null, detail: null, amountIn: null, grossVenueOutput: null, netUserOutput: null, venueFeeAmount: null, priceImpactBps: null, slot: null, executionPath: null, onchainCheckedAtQuote: null, source: null },
      { venue: "jupiter" as const, available: true, reason: null, latencyMs: 300, poolAddress: null, detail: null, amountIn: null, grossVenueOutput: null, netUserOutput: null, venueFeeAmount: null, priceImpactBps: null, slot: null, executionPath: null, onchainCheckedAtQuote: null, source: null },
      { venue: "meteora" as const, available: false, reason: "NO_VERIFIED_POOL" as const, latencyMs: 1, poolAddress: null, detail: null, amountIn: null, grossVenueOutput: null, netUserOutput: null, venueFeeAmount: null, priceImpactBps: null, slot: null, executionPath: null, onchainCheckedAtQuote: null, source: null },
    ],
  }));
  const s = summarizeBenchmarks(recs);
  assert.equal(s.records, 5);
  assert.equal(s.comparable, 5);
  assert.equal(s.directWins, 3);
  assert.equal(s.directWinRate, 0.6);
  assert.equal(s.medianDirectVsJupiterBps, 5);
  const ray = s.venues.find((v) => v.venue === "raydium")!;
  assert.equal(ray.asked, 5);
  assert.equal(ray.available, 5);
  assert.equal(ray.wins, 3);
  assert.equal(ray.medianLatencyMs, 120);
  assert.equal(ray.p95LatencyMs, 140);
  const met = s.venues.find((v) => v.venue === "meteora")!;
  assert.equal(met.available, 0);
  assert.equal(met.reasons.NO_VERIFIED_POOL, 5);
});

test("JSONL sink appends one parseable line per record; MultiSink fans out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "henar-bench-"));
  const path = join(dir, "bench.jsonl");
  const file = new JsonlFileSink(path);
  const memory = new MemorySink();
  const multi = new MultiSink([file, memory, { record: () => { throw new Error("bad sink"); } }]);
  await quoteRepresentation(buy(), { enabled: true, telemetry: multi, adapters: [adapter("jupiter", (r) => ok("jupiter", r, "1"))] });
  await quoteRepresentation(buy(), { enabled: true, telemetry: multi, adapters: [adapter("jupiter", (r) => ok("jupiter", r, "2"))] });
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).bestNetOutput, "2");
  assert.equal(memory.records.length, 2);
});
