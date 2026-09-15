/**
 * Benchmark framework (Task 25) — LIVE_VALIDATION_PENDING until run tonight.
 *
 * Quotes every enabled representation at a size ladder through the full
 * router (all five adapters + guard) and Jupiter, and records one
 * `MatrixRecord` per (representation, size, side) to a JSONL log. Never runs
 * on fixtures: without SOLANA_RPC_URL and JUPITER_API_KEY it exits non-zero,
 * so production statistics can only come from live results.
 *
 *   npm run router:benchmark:matrix -- [limitRepresentations]
 *   env: BENCH_SIZES="10,100,1000,5000,10000,25000,50000" HENAR_ROUTER_MATRIX_LOG=logs/router-matrix.jsonl
 */
import { appendFile, mkdir } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import {
  MemorySink,
  USDC_MINT,
  loadPoolRegistry,
  quoteRepresentation,
  routerRepresentation,
  summarizeBenchmarks,
  type QuoteRequest,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardResult } from "@henar/execution-guard";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";

export type MatrixRecord = {
  schema: "henar.router.matrix.v1";
  run: string;
  recordedAt: string;
  company: string;
  representationId: string;
  symbol: string;
  provider: string;
  side: "buy" | "sell";
  sizeUsd: number;
  amountIn: string;
  henar: { venue: string | null; netOutput: string | null; expectedOutput: string | null; priceImpactBps: number | null; legs: number; approved: boolean; reason: string | null; latencyMs: number | null; slot: number | null };
  jupiter: { netOutput: string | null; priceImpactBps: number | null; latencyMs: number | null; reason: string | null };
  winner: "henar" | "jupiter" | "tie" | "none";
  differenceBps: number | null;
  exclusions: { venue: string; reason: string }[];
  live: true;
};

const DEFAULT_SIZES = [10, 100, 1_000, 5_000, 10_000, 25_000, 50_000];

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const key = process.env.JUPITER_API_KEY;
  if (!rpc || !key) throw new Error("SOLANA_RPC_URL and JUPITER_API_KEY are required; the matrix never runs on fixtures.");
  const connection = new Connection(rpc, "confirmed");
  const sizes = (process.env.BENCH_SIZES ?? DEFAULT_SIZES.join(",")).split(",").map(Number).filter((n) => n > 0);
  const log = process.env.HENAR_ROUTER_MATRIX_LOG ?? "logs/router-matrix.jsonl";
  await mkdir("logs", { recursive: true });
  const run = new Date().toISOString();
  const limit = Number(process.argv[2] ?? "25");
  const adapters = [jupiterAdapter, raydiumAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter];
  const sink = new MemorySink();
  const registry = loadPoolRegistry();
  const reps = [...registry.byRepresentation.entries()].filter(([, p]) => p.some((x) => x.enabled)).map(([id]) => id).slice(0, limit);
  const records: MatrixRecord[] = [];

  for (const id of reps) {
    const rep = routerRepresentation(id);
    if (!rep) continue;
    for (const sizeUsd of sizes) {
      const usdc = BigInt(Math.round(sizeUsd * 1_000_000));
      const requests: QuoteRequest[] = [
        { representationId: id, side: "buy", amount: usdc.toString(), amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint },
      ];
      for (const request of requests) {
        const now = Date.now();
        const result = await quoteRepresentation(request, { adapters, connection, enabled: true, telemetry: sink, telemetryTags: { run, matrix: "1" } });
        const slot = await connection.getSlot("confirmed");
        const guarded = guardResult(result, DEFAULT_EXECUTION_POLICY, { now, currentSlot: slot, reference: null, representationDecimals: rep.decimals });
        const ranked = result.best ? [result.best, ...result.alternatives] : result.alternatives;
        const jup = ranked.find((q) => q.venue === "jupiter") ?? null;
        const direct = guarded.verdicts.find((v) => v.quote.venue !== "jupiter" && v.approved) ?? guarded.verdicts.find((v) => v.quote.venue !== "jupiter") ?? null;
        const h = direct?.quote ?? null;
        const hOut = h ? BigInt(h.netOutput) : null;
        const jOut = jup ? BigInt(jup.netOutput) : null;
        const diff = hOut !== null && jOut !== null && jOut > 0n ? Number(((hOut - jOut) * 1_000_000n) / jOut) / 100 : null;
        const rec: MatrixRecord = {
          schema: "henar.router.matrix.v1",
          run,
          recordedAt: new Date().toISOString(),
          company: rep.equityId,
          representationId: id,
          symbol: rep.tokenSymbol,
          provider: rep.provider,
          side: request.side,
          sizeUsd,
          amountIn: request.amount,
          henar: { venue: h?.venue ?? null, netOutput: h?.netOutput ?? null, expectedOutput: h?.fees.grossVenueOutput ?? null, priceImpactBps: h?.priceImpactBps ?? null, legs: h ? 1 : 0, approved: direct?.approved ?? false, reason: direct?.reason ?? null, latencyMs: h ? (result.latencyMs[h.venue] ?? null) : null, slot: h?.slot ?? null },
          jupiter: { netOutput: jup?.netOutput ?? null, priceImpactBps: jup?.priceImpactBps ?? null, latencyMs: jup ? (result.latencyMs.jupiter ?? null) : null, reason: result.exclusions.find((x) => x.venue === "jupiter")?.reason ?? null },
          winner: diff === null ? (hOut ? "henar" : jOut ? "jupiter" : "none") : diff > 0 ? "henar" : diff < 0 ? "jupiter" : "tie",
          differenceBps: diff,
          exclusions: result.exclusions.map((x) => ({ venue: x.venue, reason: x.reason })),
          live: true,
        };
        records.push(rec);
        await appendFile(log, `${JSON.stringify(rec)}\n`, "utf8");
        process.stdout.write(`${rep.tokenSymbol.padEnd(8)} $${String(sizeUsd).padStart(6)} henar=${rec.henar.venue ?? "-"} ${rec.henar.netOutput ?? "-"} jup=${rec.jupiter.netOutput ?? "-"} ${rec.winner} ${diff ?? ""}\n`);
      }
    }
  }
  const s = summarizeBenchmarks(sink.records);
  const bySize = new Map<number, { n: number; henar: number; diffs: number[] }>();
  for (const r of records) {
    const e = bySize.get(r.sizeUsd) ?? { n: 0, henar: 0, diffs: [] };
    e.n += 1;
    if (r.winner === "henar") e.henar += 1;
    if (r.differenceBps !== null) e.diffs.push(r.differenceBps);
    bySize.set(r.sizeUsd, e);
  }
  process.stdout.write(`\nRun ${run}: ${records.length} records, log ${log}\n`);
  for (const [size, e] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...e.diffs].sort((a, b) => a - b);
    process.stdout.write(`  $${String(size).padStart(6)}: henar wins ${e.henar}/${e.n}, median diff ${sorted.length ? sorted[Math.floor(sorted.length / 2)] : "n/a"} bps\n`);
  }
  process.stdout.write(`  telemetry: direct win rate ${s.directWinRate === null ? "n/a" : `${(s.directWinRate * 100).toFixed(0)}%`}, median ${s.medianDirectVsJupiterBps ?? "n/a"} bps\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
