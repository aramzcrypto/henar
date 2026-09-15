/**
 * Router benchmark: every direct venue versus Jupiter, side by side, with
 * every result recorded through the Task 8 telemetry sink.
 *
 * For each representation with at least one enabled pool, quotes a fixed
 * USDC notional on both sides through every adapter, prints the net output
 * per venue with the exclusion reason for any venue that could not quote,
 * appends one JSONL record per quote, and ends with a summary (win rate,
 * median delta vs Jupiter, per-venue availability and latency). Read-only;
 * nothing is signed or sent.
 *
 *   SOLANA_RPC_URL=… JUPITER_API_KEY=… HENAR_METEORA_DBC_QUOTES=1 \
 *   HENAR_METEORA_DAMM_V2_QUOTES=1 npm run router:benchmark -- 100
 *
 * Without SOLANA_RPC_URL the direct venues report VENUE_NOT_CONFIGURED and
 * without JUPITER_API_KEY the benchmark column is empty; the table still
 * prints and records so the failure mode is visible rather than hidden.
 * Log path: HENAR_ROUTER_BENCHMARK_LOG (default logs/router-benchmark.jsonl).
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Connection } from "@solana/web3.js";
import {
  JsonlFileSink,
  MemorySink,
  MultiSink,
  USDC_MINT,
  loadPoolRegistry,
  quoteRepresentation,
  routerRepresentation,
  summarizeBenchmarks,
  type QuoteRequest,
  type RankedQuote,
} from "@henar/router-core";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";

const USDC_DECIMALS = 6;

function units(amount: bigint, decimals: number | null) {
  if (decimals === null) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

async function main() {
  const notional = Number(process.argv[2] ?? "100");
  const usdcIn = BigInt(Math.round(notional * 10 ** USDC_DECIMALS));
  const rpc = process.env.SOLANA_RPC_URL;
  const connection = rpc ? new Connection(rpc, "confirmed") : null;
  const adapters = [jupiterAdapter, raydiumAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter];
  const registry = loadPoolRegistry();

  const logPath = process.env.HENAR_ROUTER_BENCHMARK_LOG ?? "logs/router-benchmark.jsonl";
  await mkdir(dirname(logPath), { recursive: true });
  const memory = new MemorySink();
  const telemetry = new MultiSink([memory, new JsonlFileSink(logPath)]);
  const run = new Date().toISOString();
  const tags = { run, notional: String(notional), rpc: rpc ? "yes" : "no", jupiter: process.env.JUPITER_API_KEY ? "yes" : "no" };

  const reps = [...registry.byRepresentation.entries()]
    .filter(([, pools]) => pools.some((p) => p.enabled))
    .map(([id]) => id)
    .slice(0, Number(process.env.BENCH_LIMIT ?? "10"));

  process.stdout.write(
    `Benchmark: ${notional} USDC notional, ${reps.length} representations, rpc=${tags.rpc}, jupiter=${tags.jupiter}, log=${logPath}\n\n`,
  );

  for (const id of reps) {
    const rep = routerRepresentation(id);
    if (!rep) continue;
    const buy: QuoteRequest = {
      representationId: id,
      side: "buy",
      amount: usdcIn.toString(),
      amountType: "input",
      inputMint: USDC_MINT,
      outputMint: rep.mint,
    };
    const buyResult = await quoteRepresentation(buy, { adapters, connection, enabled: true, telemetry, telemetryTags: tags });
    const line = (q: RankedQuote, decimals: number | null, symbol: string) =>
      `${q.venue.padEnd(16)} net ${units(BigInt(q.netOutput), decimals).padStart(16)} ${symbol}  impact ${q.priceImpactBps ?? "?"}bps  ${buyResult.latencyMs[q.venue] ?? "?"}ms`;
    process.stdout.write(`${rep.tokenSymbol} (${rep.provider}) buy ${notional} USDC\n`);
    for (const q of [buyResult.best, ...buyResult.alternatives]) if (q) process.stdout.write(`  ${line(q, rep.decimals, rep.tokenSymbol)}\n`);
    for (const x of buyResult.exclusions) process.stdout.write(`  ${x.venue.padEnd(16)} ${x.reason}${x.detail ? ` — ${x.detail}` : ""}\n`);

    // Sell the amount the best buy would have produced, or a nominal unit.
    const sellAmount = buyResult.best ? BigInt(buyResult.best.netOutput) : 10n ** BigInt(rep.decimals ?? 0);
    if (sellAmount > 0n) {
      const sell: QuoteRequest = {
        representationId: id,
        side: "sell",
        amount: sellAmount.toString(),
        amountType: "input",
        inputMint: rep.mint,
        outputMint: USDC_MINT,
      };
      const sellResult = await quoteRepresentation(sell, { adapters, connection, enabled: true, telemetry, telemetryTags: tags });
      process.stdout.write(`${rep.tokenSymbol} sell ${units(sellAmount, rep.decimals)}\n`);
      for (const q of [sellResult.best, ...sellResult.alternatives])
        if (q)
          process.stdout.write(
            `  ${q.venue.padEnd(16)} net ${units(BigInt(q.netOutput), USDC_DECIMALS).padStart(14)} USDC  impact ${q.priceImpactBps ?? "?"}bps  ${sellResult.latencyMs[q.venue] ?? "?"}ms\n`,
          );
      for (const x of sellResult.exclusions) process.stdout.write(`  ${x.venue.padEnd(16)} ${x.reason}${x.detail ? ` — ${x.detail}` : ""}\n`);
    }
    process.stdout.write("\n");
  }

  const summary = summarizeBenchmarks(memory.records);
  process.stdout.write("Summary\n");
  process.stdout.write(
    `  records ${summary.records}, with best ${summary.withBest}, comparable to Jupiter ${summary.comparable}, direct wins ${summary.directWins}` +
      `${summary.directWinRate === null ? "" : ` (${(summary.directWinRate * 100).toFixed(0)}%)`}, median direct−Jupiter ${summary.medianDirectVsJupiterBps ?? "n/a"} bps\n`,
  );
  for (const v of summary.venues) {
    const reasons = Object.entries(v.reasons)
      .map(([r, n]) => `${r}×${n}`)
      .join(", ");
    process.stdout.write(
      `  ${v.venue.padEnd(16)} asked ${v.asked}, available ${v.available}, wins ${v.wins}, p50 ${v.medianLatencyMs ?? "?"}ms, p95 ${v.p95LatencyMs ?? "?"}ms${reasons ? `  [${reasons}]` : ""}\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
