/**
 * Benchmark framework (Task 25) — LIVE_VALIDATION_PENDING until run tonight.
 *
 * Quotes every enabled representation at a size ladder through the full
 * router (all five adapters + guard) and Jupiter, and records one
 * `MatrixRecord` per (representation, size, side) to a JSONL log. Never runs
 * on fixtures: without SOLANA_RPC_URL and JUPITER_API_KEY it exits non-zero,
 * so production statistics can only come from live results.
 *
 * Buys and sells. A sell needs a token quantity, so it is derived from one
 * reference-price snapshot per run, recorded with the row; a representation
 * with no verified price is counted as a skipped sell rather than measured
 * against a guess.
 *
 * Every row reports two winners: the best approved quote whatever its
 * execution capability, and the best route this configuration can actually
 * execute. A QUOTE_ONLY venue winning on price is not an execution win.
 *
 *   npm run router:benchmark:matrix -- [limitRepresentations]
 *   env: BENCH_SIZES="10,100,1000,5000,10000,25000,50000" HENAR_ROUTER_MATRIX_LOG=logs/router-matrix.jsonl
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import {
  MemorySink,
  USDC_MINT,
  loadPoolRegistry,
  quoteRepresentation,
  routerRepresentation,
  summarizeBenchmarks,
  unavailableQuote,
  type QuoteRequest,
  type VenueAdapter,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardResult } from "@henar/execution-guard";
import { capabilityOf, selectRoute } from "@henar/router-app";
import { jupiterMetadata } from "@/lib/equities/jupiter";
import { RateLimitError, retryAfterMs } from "@/lib/execution/shared";
import { createLimiter } from "./rate-limit";
import { createNativeGate, type GateResult } from "./native-gate";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";
import { byrealAdapter } from "@henar/venue-byreal";

export type VenueObservation = {
  venue: string;
  netOutput: string | null;
  grossOutput: string | null;
  priceImpactBps: number | null;
  approved: boolean;
  capability: string;
  reason: string | null;
  poolAddress: string | null;
  slot: number | null;
  quotedAt: string | null;
  latencyMs: number | null;
};

export type MatrixRecord = {
  schema: "henar.router.matrix.v3";
  run: string;
  recordedAt: string;
  company: string;
  representationId: string;
  symbol: string;
  provider: string;
  side: "buy" | "sell";
  sizeUsd: number;
  amountIn: string;
  /** Slot of the single state read every size on this representation used. */
  snapshotSlot: number | null;
  /** The slot the guard was told was current; a past one refuses every quote. */
  guardSlot: number | null;
  /** Set when a venue could not be measured because it kept rate limiting. */
  rateLimited: string[];
  /** For sells: where the token quantity came from. Null for buys. */
  sellBasis: {
    referencePriceUsd: number;
    priceSource: string;
    priceAt: string;
    scaledUiMultiplier: number;
    rawTokenQuantity: string;
    requestedNotionalUsd: number;
  } | null;
  venues: VenueObservation[];
  henar: { venue: string | null; netOutput: string | null; expectedOutput: string | null; priceImpactBps: number | null; legs: number; approved: boolean; reason: string | null; latencyMs: number | null; slot: number | null };
  jupiter: { netOutput: string | null; priceImpactBps: number | null; latencyMs: number | null; reason: string | null };
  /** Highest approved quote, whatever its execution capability. */
  bestObserved: { venue: string; netOutput: string; capability: string } | null;
  /** Highest approved route this configuration can actually execute. */
  bestSelectable: { venue: string; netOutput: string; capability: string } | null;
  /** Build+simulate outcome for each native candidate, in the order tried. */
  nativeGate: { venue: string; stage: string; detail: string; computeUnits: number | null }[];
  /** Native candidates demoted for failing the gate, best-first. */
  nativeDemoted: string[];
  /** How much the best price exceeds what can be executed. */
  observedVsSelectableBps: number | null;
  henarFeeBps: number | null;
  henarFeeAmount: string | null;
  rfq: boolean;
  multiHop: boolean;
  splitLegs: number;
  intermediateMints: string[];
  winner: "henar" | "jupiter" | "tie" | "none";
  differenceBps: number | null;
  exclusions: { venue: string; reason: string; detail?: string | null }[];
  live: true;
};

/* Tiny, ordinary retail, meaningful, large. $100/$5k/$25k only interpolate
   between these and cost a fifth of the run each. */
const DEFAULT_SIZES = [10, 1_000, 10_000, 50_000];

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const key = process.env.JUPITER_API_KEY;
  if (!rpc || !key) throw new Error("SOLANA_RPC_URL and JUPITER_API_KEY are required; the matrix never runs on fixtures.");
  const sizes = (process.env.BENCH_SIZES ?? DEFAULT_SIZES.join(",")).split(",").map(Number).filter((n) => n > 0);
  const log = process.env.HENAR_ROUTER_MATRIX_LOG ?? "logs/router-matrix.jsonl";
  await mkdir("logs", { recursive: true });
  const run = new Date().toISOString();
  const limit = Number(process.argv[2] ?? "25");
  /* BENCH_EXCLUDE_VENUES drops venues from the run so their contribution can
     be measured by difference — "what is Meteora worth?" is answered by the
     gap between a run with it and a run without. It changes what is measured,
     never what is required: an excluded venue is absent, not downgraded, and
     every venue still in the run must satisfy the executability invariant. */
  const excluded = new Set((process.env.BENCH_EXCLUDE_VENUES ?? "").split(",").map((v) => v.trim()).filter(Boolean));
  const directAdapters = [raydiumAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter, byrealAdapter]
    .filter((a) => !excluded.has(a.venue));
  if (excluded.size) process.stdout.write(`Excluding venues: ${[...excluded].join(", ")}\n`);
  const sink = new MemorySink();
  const registry = loadPoolRegistry();
  const reps = [...registry.byRepresentation.entries()].filter(([, p]) => p.some((x) => x.enabled)).map(([id]) => id).slice(0, limit);
  let skippedSells = 0;

  /* One reference snapshot for the run, so every sell in it is derived from a
     price with a known source and time rather than whatever was current when
     that row happened to execute. */
  /* One RPC queue for the whole run, and a slower one for Jupiter. The
     previous run died on a fatal RPC 429 after 35 of 350 observations; these
     trade wall-clock for finishing.

     The queue is installed under the Connection itself rather than around the
     few calls this script makes directly. Every adapter reads chain state
     through this same Connection, so a limiter wrapped only around call sites
     here throttles almost nothing: a second attempt at the run still died at
     23 observations because the adapters' own reads never passed through it. */
  const records: MatrixRecord[] = [];
  let rpcCalls = 0;
  const rpcLimit = createLimiter({
    minIntervalMs: Number(process.env.BENCH_RPC_INTERVAL_MS ?? "120"),
    retries: Number(process.env.BENCH_RPC_RETRIES ?? "8"),
    label: "rpc",
    onBackoff: (waitMs, attempt) =>
      process.stdout.write(`  rpc backoff ${waitMs}ms (attempt ${attempt})\n`),
  });
  const connection = new Connection(rpc, {
    commitment: "confirmed",
    // A 429 is thrown so the limiter owns the retry and the wait: web3.js's
    // own retry is fixed at five quick attempts and then fatal, which is
    // exactly how the last two runs were lost.
    fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      rpcLimit(async () => {
        rpcCalls += 1;
        const response = await fetch(input, init);
        if (response.status === 429)
          throw new RateLimitError(
            "RPC rate limit (429).",
            retryAfterMs(response.headers.get("retry-after")),
          );
        return response;
      })) as never,
  });
  /* Every venue is asked through one serialised RPC queue, so the 6s default
     would time out venues merely for being late in the queue. A timeout is
     recorded as an unavailable venue, and a venue we throttled ourselves must
     never be mistaken for a venue with no liquidity. */
  const deadlineMs = Number(process.env.BENCH_DEADLINE_MS ?? "60000");
  const jupiterLimit = createLimiter({
    minIntervalMs: Number(process.env.BENCH_JUPITER_INTERVAL_MS ?? "900"),
    label: "jupiter",
    onBackoff: (waitMs, attempt) =>
      process.stdout.write(`  jupiter backoff ${waitMs}ms (attempt ${attempt})\n`),
  });

  /* Jupiter is asked through the paced queue, and a 429 is re-thrown so the
     queue can honour Retry-After and retry instead of recording the venue as
     having no route. Only a rate limit that survives every retry is recorded,
     and it is recorded as RATE_LIMIT_RETRY. */
  const pacedJupiter: VenueAdapter = {
    ...jupiterAdapter,
    venue: jupiterAdapter.venue,
    capabilities: jupiterAdapter.capabilities.bind(jupiterAdapter),
    health: jupiterAdapter.health.bind(jupiterAdapter),
    buildSwapInstructions: jupiterAdapter.buildSwapInstructions.bind(jupiterAdapter),
    getQuote: async (request, ctx) =>
      jupiterLimit(async () => {
        const quote = await jupiterAdapter.getQuote(request, ctx);
        if (quote.unavailableReason === "RATE_LIMIT_RETRY")
          throw new RateLimitError(quote.unavailableDetail ?? "Jupiter rate limit (429).", null);
        return quote;
      }).catch((error: unknown) =>
        error instanceof RateLimitError
          ? unavailableQuote("jupiter", request, "RATE_LIMIT_RETRY", error.message, null, ctx.now)
          : Promise.reject(error),
      ),
  };
  const adapters = [pacedJupiter, ...directAdapters];

  /* A native win must be executable, not merely selected. The gate plans,
     builds and simulates the candidate against mainnet; a candidate that
     cannot do all three is demoted with its reason rather than counted, and
     the next best route is considered in its place. */
  const treasuryOwner = process.env.STOCKROOM_TREASURY_OWNER;
  if (!treasuryOwner) throw new Error("STOCKROOM_TREASURY_OWNER is required to plan the fee transfer for the native gate.");
  const gate = createNativeGate({ connection, adapters: directAdapters, treasuryOwner });

  /* Resume: an observation is identified by representation, side and notional,
     so a killed run continues instead of restarting. Rows from a different
     schema are ignored, because mixing methodologies would corrupt the
     aggregate rather than extend it. */
  const done = new Set<string>();
  const keyOf = (representationId: string, side: string, sizeUsd: number) =>
    `${representationId}|${side}|${sizeUsd}`;
  try {
    const existing = await readFile(log, "utf8");
    for (const line of existing.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as MatrixRecord;
      if (row.schema !== "henar.router.matrix.v3") continue;
      done.add(keyOf(row.representationId, row.side, row.sizeUsd));
      records.push(row);
    }
    if (done.size) process.stdout.write(`resuming: ${done.size} observations already recorded in ${log}\n`);
  } catch {
    // No prior log; a fresh run.
  }

  const referenceAt = new Date().toISOString();
  const reference = await jupiterMetadata(
    reps
      .map((id) => routerRepresentation(id))
      .filter((r): r is NonNullable<typeof r> => r !== null) as never,
  );

  for (const id of reps) {
    const rep = routerRepresentation(id);
    if (!rep) continue;
    // One state read per representation, recorded so every row below is
    // attributable to a known chain position.
    const snapshotSlot = await connection.getSlot("confirmed");
    // Owner discovery for the gate happens here, outside any quote's freshness
    // window, so a native candidate is never demoted for our latency.
    await gate.warm(rep.mint, USDC_MINT);
    for (const sizeUsd of sizes) {
      const usdc = BigInt(Math.round(sizeUsd * 1_000_000));
      const requests: { request: QuoteRequest; sellBasis: MatrixRecord["sellBasis"] }[] = [
        {
          request: { representationId: id, side: "buy", amount: usdc.toString(), amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint },
          sellBasis: null,
        },
      ];
      /* A sell starts from a token quantity, so it needs a price. Derive it
         from a named, timestamped reference snapshot and record what was used:
         a sell measured against a stale or absent price is not a measurement.
         Display units carry the price, so raw = units / multiplier x 10^dec. */
      const live = reference.get(rep.mint) ?? null;
      // The router registry often has decimals unverified; the same snapshot
      // that carries the price carries them, so prefer the registry and fall
      // back rather than skipping a sell over a field we already have.
      const sellDecimals = rep.decimals ?? live?.decimals ?? null;
      if (live?.referencePrice && live.referencePrice > 0 && sellDecimals !== null) {
        const multiplier = live.multiplier > 0 ? live.multiplier : 1;
        const displayUnits = sizeUsd / live.referencePrice;
        const raw = BigInt(Math.round((displayUnits / multiplier) * 10 ** sellDecimals));
        if (raw > 0n)
          requests.push({
            request: { representationId: id, side: "sell", amount: raw.toString(), amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT },
            sellBasis: {
              referencePriceUsd: live.referencePrice,
              priceSource: "jupiter:stockData.price",
              priceAt: live.asOf ?? referenceAt,
              scaledUiMultiplier: multiplier,
              rawTokenQuantity: raw.toString(),
              requestedNotionalUsd: sizeUsd,
            },
          });
      } else {
        skippedSells += 1;
      }
      for (const { request, sellBasis } of requests) {
        if (done.has(keyOf(id, request.side, sizeUsd))) continue;
        const now = Date.now();
        const result = await quoteRepresentation(request, { adapters, connection, enabled: true, deadlineMs, telemetry: sink, telemetryTags: { run, matrix: "1" } });
        /* The guard needs the CURRENT slot, not the snapshot's.
           Reusing the snapshot slot as "now" refused every native quote as
           ROUTE_STATE_STALE — the guard requires currentSlot >= quote.slot,
           and a quote taken after the snapshot is always ahead of it. That
           cost a whole 196-observation run: native was approved zero times,
           for a reason that was the harness's clock, not the venue's state. */
        const slot = await connection.getSlot("confirmed");
        const guarded = guardResult(result, DEFAULT_EXECUTION_POLICY, { now, currentSlot: slot, reference: null, representationDecimals: rep.decimals });
        const ranked = result.best ? [result.best, ...result.alternatives] : result.alternatives;
        const jup = ranked.find((q) => q.venue === "jupiter") ?? null;
        const direct = guarded.verdicts.find((v) => v.quote.venue !== "jupiter" && v.approved) ?? guarded.verdicts.find((v) => v.quote.venue !== "jupiter") ?? null;
        const h = direct?.quote ?? null;
        const hOut = h ? BigInt(h.netOutput) : null;
        const jOut = jup ? BigInt(jup.netOutput) : null;
        const diff = hOut !== null && jOut !== null && jOut > 0n ? Number(((hOut - jOut) * 1_000_000n) / jOut) / 100 : null;
        const venues: VenueObservation[] = guarded.verdicts.map((v) => ({
          venue: v.quote.venue,
          netOutput: v.quote.netOutput,
          grossOutput: v.quote.fees.grossVenueOutput,
          priceImpactBps: v.quote.priceImpactBps,
          approved: v.approved,
          capability: capabilityOf(v),
          reason: v.reason,
          poolAddress: v.quote.poolAddress,
          slot: v.quote.slot ?? null,
          quotedAt: v.quote.quotedAt,
          latencyMs: result.latencyMs[v.quote.venue] ?? null,
        }));
        /* Two different questions. The best price available says whether the
           liquidity exists; the best price executable says what a user would
           actually receive today. A QUOTE_ONLY venue winning on price is not
           an execution win, and conflating them would report a capability we
           do not have. */
        const approved = guarded.verdicts.filter((v) => v.approved);
        const observed = approved.length
          ? approved.reduce((a, b) => (BigInt(b.quote.netOutput) > BigInt(a.quote.netOutput) ? b : a))
          : null;
        /* selectRoute ranks on price and capability only. Every native
           candidate it returns is put through the gate; a failure is recorded
           and the candidate withdrawn, then selection runs again on what is
           left. An external or quote-only winner needs no gate: it is not a
           Henar execution claim. */
        const nativeGate: MatrixRecord["nativeGate"] = [];
        const nativeDemoted: string[] = [];
        let candidates = guarded.verdicts;
        let selectable = selectRoute(candidates) ?? null;
        while (selectable && capabilityOf(selectable) === "HENAR_NATIVE") {
          const outcome: GateResult = await gate.check(selectable, request, rep);
          nativeGate.push({ venue: selectable.quote.venue, stage: outcome.stage, detail: outcome.detail, computeUnits: outcome.computeUnits ?? null });
          if (outcome.stage === "PASS") break;
          nativeDemoted.push(selectable.quote.venue);
          const withdrawn = selectable;
          candidates = candidates.filter((v) => v !== withdrawn);
          selectable = selectRoute(candidates) ?? null;
        }
        const gapBps =
          observed && selectable && BigInt(observed.quote.netOutput) > 0n
            ? Number(
                ((BigInt(observed.quote.netOutput) - BigInt(selectable.quote.netOutput)) * 1_000_000n) /
                  BigInt(observed.quote.netOutput),
              ) / 100
            : null;
        const routePlan = (selectable?.quote.rawRouteMetadata as { route?: { venue?: string }[] } | null)?.route ?? null;
        const rec: MatrixRecord = {
          schema: "henar.router.matrix.v3",
          snapshotSlot,
          guardSlot: slot,
          rateLimited: result.exclusions
            .filter((x) => /rate|429/i.test(`${x.reason} ${x.detail ?? ""}`))
            .map((x) => x.venue),
          sellBasis,
          venues,
          bestObserved: observed
            ? { venue: observed.quote.venue, netOutput: observed.quote.netOutput, capability: capabilityOf(observed) }
            : null,
          bestSelectable: selectable
            ? { venue: selectable.quote.venue, netOutput: selectable.quote.netOutput, capability: capabilityOf(selectable) }
            : null,
          nativeGate,
          nativeDemoted,
          observedVsSelectableBps: gapBps,
          henarFeeBps: selectable?.quote.henarFeeBps ?? null,
          henarFeeAmount: selectable?.quote.henarFeeAmount ?? null,
          rfq: (routePlan ?? []).some((leg) => /jupiterz|rfq/i.test(String(leg.venue ?? ""))),
          multiHop: (routePlan ?? []).length > 1,
          splitLegs: result.route?.kind === "split" ? result.route.legs.length : 1,
          intermediateMints: [],
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
          /* The detail is kept, not just the reason. Reporting why Native
             disappeared at $50k needed the message behind SDK_ERROR, and a
             log that records only the code cannot answer it. */
          exclusions: result.exclusions.map((x) => ({ venue: x.venue, reason: x.reason, detail: x.detail ?? null })),
          live: true,
        };
        records.push(rec);
        await appendFile(log, `${JSON.stringify(rec)}\n`, "utf8");
        process.stdout.write(
          `${rep.tokenSymbol.padEnd(8)} ${request.side.padEnd(4)} $${String(sizeUsd).padStart(6)} observed=${rec.bestObserved?.venue ?? "-"}/${rec.bestObserved?.capability ?? "-"} selectable=${rec.bestSelectable?.venue ?? "-"}/${rec.bestSelectable?.capability ?? "-"} gap=${rec.observedVsSelectableBps ?? "-"}bps${rec.nativeGate.length ? ` gate=${rec.nativeGate.map((g) => `${g.venue}:${g.stage}`).join(",")}` : ""}\n`,
        );
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
  process.stdout.write(
    `\nRun ${run}: ${records.length} records (${records.filter((r) => r.side === "sell").length} sells, ${skippedSells} sells skipped for want of a verified price), log ${log}\n`,
  );
  for (const [size, e] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...e.diffs].sort((a, b) => a - b);
    process.stdout.write(`  $${String(size).padStart(6)}: henar wins ${e.henar}/${e.n}, median diff ${sorted.length ? sorted[Math.floor(sorted.length / 2)] : "n/a"} bps\n`);
  }
  process.stdout.write(`  rpc calls through the queue: ${rpcCalls}\n`);
  process.stdout.write(`  telemetry: direct win rate ${s.directWinRate === null ? "n/a" : `${(s.directWinRate * 100).toFixed(0)}%`}, median ${s.medianDirectVsJupiterBps ?? "n/a"} bps\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
