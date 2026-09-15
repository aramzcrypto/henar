/**
 * Benchmark / telemetry records for the router (Task 8).
 *
 * Every `EngineResult` reduces to one `BenchmarkRecord`: what was asked,
 * what each venue answered (or why not), how long it took, and how the
 * best direct venue compares with Jupiter on net output. Records are the
 * evidence base for the phase gates — "direct beats Jupiter on X% of
 * quotes" is read from them, never asserted.
 *
 * Sinks are pluggable. The engine accepts a `TelemetrySink`; production
 * uses the JSONL file sink (`HENAR_ROUTER_BENCHMARK_LOG`), tests use the
 * memory sink. Recording never throws into the quote path.
 */
import { appendFile } from "node:fs/promises";
import { fromRaw } from "./types";
import type { EngineResult, QuoteRequest, UnavailableReason, Venue } from "./types";

export type VenueOutcome = {
  venue: Venue;
  poolAddress: string | null;
  available: boolean;
  reason: UnavailableReason | null;
  detail: string | null;
  latencyMs: number | null;
  amountIn: string | null;
  grossVenueOutput: string | null;
  netUserOutput: string | null;
  venueFeeAmount: string | null;
  priceImpactBps: number | null;
  slot: number | null;
  executionPath: string | null;
  onchainCheckedAtQuote: boolean | null;
  source: string | null;
};

export type BenchmarkRecord = {
  schema: "henar.router.benchmark.v1";
  recordedAt: string;
  quotedAt: string;
  enabled: boolean;
  request: Pick<QuoteRequest, "representationId" | "side" | "amount" | "amountType" | "inputMint" | "outputMint">;
  venues: VenueOutcome[];
  bestVenue: Venue | null;
  bestNetOutput: string | null;
  /** Best net output among non-Jupiter venues. */
  bestDirectVenue: Venue | null;
  bestDirectNetOutput: string | null;
  jupiterNetOutput: string | null;
  /**
   * (bestDirect − jupiter) / jupiter in basis points, integer. Positive
   * means direct routing beat the benchmark. Null when either is missing.
   */
  directVsJupiterBps: number | null;
  slot: number | null;
  tags: Record<string, string>;
};

export interface TelemetrySink {
  record(record: BenchmarkRecord): Promise<void> | void;
}

export function benchmarkRecord(
  result: EngineResult,
  options: { now?: number; tags?: Record<string, string> } = {},
): BenchmarkRecord {
  const now = options.now ?? Date.now();
  const ranked = result.best ? [result.best, ...result.alternatives] : result.alternatives;
  const venues: VenueOutcome[] = [
    ...ranked.map((q) => ({
      venue: q.venue,
      poolAddress: q.poolAddress,
      available: true,
      reason: null,
      detail: null,
      latencyMs: result.latencyMs[q.venue] ?? null,
      amountIn: q.amountIn,
      grossVenueOutput: q.fees.grossVenueOutput,
      netUserOutput: q.fees.netUserOutput,
      venueFeeAmount: q.venueFeeAmount,
      priceImpactBps: q.priceImpactBps,
      slot: q.slot,
      executionPath: q.executionPath,
      onchainCheckedAtQuote: q.onchainCheckedAtQuote,
      source: q.source,
    })),
    ...result.exclusions.map((x) => ({
      venue: x.venue,
      poolAddress: x.poolAddress,
      available: false,
      reason: x.reason,
      detail: x.detail,
      latencyMs: result.latencyMs[x.venue] ?? null,
      amountIn: null,
      grossVenueOutput: null,
      netUserOutput: null,
      venueFeeAmount: null,
      priceImpactBps: null,
      slot: null,
      executionPath: null,
      onchainCheckedAtQuote: null,
      source: null,
    })),
  ];

  const jupiter = ranked.find((q) => q.venue === "jupiter") ?? null;
  const bestDirect = ranked.find((q) => q.venue !== "jupiter") ?? null;
  let directVsJupiterBps: number | null = null;
  if (jupiter && bestDirect) {
    const j = fromRaw(jupiter.netOutput);
    const d = fromRaw(bestDirect.netOutput);
    if (j > 0n) directVsJupiterBps = Number(((d - j) * 10_000n) / j);
  }

  return {
    schema: "henar.router.benchmark.v1",
    recordedAt: new Date(now).toISOString(),
    quotedAt: result.quotedAt,
    enabled: result.enabled,
    request: {
      representationId: result.request.representationId,
      side: result.request.side,
      amount: result.request.amount,
      amountType: result.request.amountType,
      inputMint: result.request.inputMint,
      outputMint: result.request.outputMint,
    },
    venues,
    bestVenue: result.best?.venue ?? null,
    bestNetOutput: result.best?.netOutput ?? null,
    bestDirectVenue: bestDirect?.venue ?? null,
    bestDirectNetOutput: bestDirect?.netOutput ?? null,
    jupiterNetOutput: jupiter?.netOutput ?? null,
    directVsJupiterBps,
    slot: result.slot,
    tags: options.tags ?? {},
  };
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

export class MemorySink implements TelemetrySink {
  readonly records: BenchmarkRecord[] = [];
  record(record: BenchmarkRecord) {
    this.records.push(record);
  }
}

/** One JSON object per line. Append-only; safe across processes. */
export class JsonlFileSink implements TelemetrySink {
  constructor(readonly path: string) {}
  async record(record: BenchmarkRecord) {
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

/** Fan out to several sinks; one failing sink never blocks another. */
export class MultiSink implements TelemetrySink {
  constructor(private readonly sinks: TelemetrySink[]) {}
  async record(record: BenchmarkRecord) {
    // A sink that throws synchronously must not escape before the others
    // are awaited; lift every call into a promise first.
    await Promise.allSettled(this.sinks.map((s) => Promise.resolve().then(() => s.record(record))));
  }
}

/** Sink from the environment: JSONL file when configured, else none. */
export function telemetrySinkFromEnv(env: NodeJS.ProcessEnv = process.env): TelemetrySink | null {
  const path = env.HENAR_ROUTER_BENCHMARK_LOG;
  return path ? new JsonlFileSink(path) : null;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type VenueSummary = {
  venue: Venue;
  asked: number;
  available: number;
  wins: number;
  reasons: Partial<Record<UnavailableReason, number>>;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type BenchmarkSummary = {
  records: number;
  withBest: number;
  comparable: number;
  directWins: number;
  directWinRate: number | null;
  medianDirectVsJupiterBps: number | null;
  venues: VenueSummary[];
};

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function summarizeBenchmarks(records: BenchmarkRecord[]): BenchmarkSummary {
  const byVenue = new Map<Venue, { asked: number; available: number; wins: number; reasons: Partial<Record<UnavailableReason, number>>; latencies: number[] }>();
  const deltas: number[] = [];
  let withBest = 0;
  let directWins = 0;
  for (const r of records) {
    if (r.bestVenue) withBest += 1;
    if (r.directVsJupiterBps !== null) {
      deltas.push(r.directVsJupiterBps);
      if (r.directVsJupiterBps > 0) directWins += 1;
    }
    for (const v of r.venues) {
      const entry = byVenue.get(v.venue) ?? { asked: 0, available: 0, wins: 0, reasons: {}, latencies: [] };
      entry.asked += 1;
      if (v.available) entry.available += 1;
      if (v.reason) entry.reasons[v.reason] = (entry.reasons[v.reason] ?? 0) + 1;
      if (v.latencyMs !== null) entry.latencies.push(v.latencyMs);
      if (r.bestVenue === v.venue && v.available) entry.wins += 1;
      byVenue.set(v.venue, entry);
    }
  }
  return {
    records: records.length,
    withBest,
    comparable: deltas.length,
    directWins,
    directWinRate: deltas.length ? directWins / deltas.length : null,
    medianDirectVsJupiterBps: percentile(deltas, 50),
    venues: [...byVenue.entries()].map(([venue, e]) => ({
      venue,
      asked: e.asked,
      available: e.available,
      wins: e.wins,
      reasons: e.reasons,
      medianLatencyMs: percentile(e.latencies, 50),
      p95LatencyMs: percentile(e.latencies, 95),
    })),
  };
}
