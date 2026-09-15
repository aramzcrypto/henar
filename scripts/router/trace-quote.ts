/**
 * Read-only trace of one router request: every venue quote, every guard
 * verdict, the split optimizer's result, and what selection would return.
 *
 * Changes no routing mathematics. It exists to answer whether the split
 * optimizer is part of a given quote and what the optimized route actually is.
 *
 *   HENAR_ROUTER_EXECUTION=1 npm run router:trace -- NVDAx buy 10000
 */
import { Connection } from "@solana/web3.js";
import {
  USDC_MINT,
  flagEnabled,
  listRouterRepresentations,
  loadPoolRegistry,
  poolsForRepresentation,
  quoteRepresentation,
  routerRepresentation,
  type QuoteRequest,
  type VenueAdapter,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardResult } from "@henar/execution-guard";
import { DEFAULT_SPLIT_OPTIONS, optimizeSplit, type VenueCurve } from "@henar/router-core";
import { capabilityOf, selectRoute } from "@henar/router-app";
import { MARKET_FEE_BPS } from "@/lib/trade-fee";
import { RateLimitError, retryAfterMs } from "@/lib/execution/shared";
import { createLimiter } from "./rate-limit";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";

const ui = (raw: string, decimals: number) => (Number(raw) / 10 ** decimals).toFixed(decimals > 6 ? 8 : 6);

async function main() {
  const [symbol = "NVDAx", side = "buy", sizeArg = "10000"] = process.argv.slice(2);
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required.");
  const rpcLimit = createLimiter({ minIntervalMs: Number(process.env.TRACE_RPC_INTERVAL_MS ?? "150"), retries: 8 });
  const connection = new Connection(rpc, {
    commitment: "confirmed",
    fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      rpcLimit(async () => {
        const response = await fetch(input, init);
        if (response.status === 429) throw new RateLimitError("RPC rate limit (429).", retryAfterMs(response.headers.get("retry-after")));
        return response;
      })) as never,
  });

  const rep = listRouterRepresentations().find((r) => r.tokenSymbol === symbol) ?? routerRepresentation(symbol);
  if (!rep) throw new Error(`unknown representation ${symbol}`);
  const decimals = rep.decimals ?? 8;
  const sizeUsd = Number(sizeArg);
  const amount = side === "buy" ? BigInt(Math.round(sizeUsd * 1_000_000)) : BigInt(Math.round(sizeUsd * 10 ** decimals));
  const request: QuoteRequest =
    side === "buy"
      ? { representationId: rep.id, side: "buy", amount: amount.toString(), amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint }
      : { representationId: rep.id, side: "sell", amount: amount.toString(), amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT };

  const pools = poolsForRepresentation(rep.id);
  process.stdout.write(`${symbol} ${side} ${sizeUsd}  (${rep.id})\n`);
  process.stdout.write(`  decimals ${rep.decimals ?? "UNVERIFIED"}  tokenProgram ${rep.tokenProgram ?? "UNVERIFIED"}\n`);
  process.stdout.write(`  registry pools: ${pools.length} enabled of ${loadPoolRegistry().byRepresentation.get(rep.id)?.length ?? 0} known\n`);
  for (const p of pools) process.stdout.write(`    ${p.venue.padEnd(9)} ${p.address} tvl ${p.tvlUsd === null ? "?" : `$${Math.round(p.tvlUsd)}`}\n`);
  process.stdout.write(`  flags: routerQuotes=${flagEnabled("routerQuotes")} routerExecution=${flagEnabled("routerExecution")} `);
  process.stdout.write(`splitRouting=${process.env.HENAR_SPLIT_ROUTING === undefined ? "unset (defaults ON)" : flagEnabled("splitRouting")}\n`);
  process.stdout.write(`  fee: ${MARKET_FEE_BPS} bps\n\n`);

  const adapters: VenueAdapter[] = [jupiterAdapter, raydiumAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter];
  const quoteStart = Date.now();
  const result = await quoteRepresentation(request, { adapters, connection, enabled: true, deadlineMs: 6_000 });
  const quoteMs = Date.now() - quoteStart;
  const slot = await connection.getSlot("confirmed");
  const guarded = guardResult(result, DEFAULT_EXECUTION_POLICY, { now: Date.now(), currentSlot: slot, reference: null, representationDecimals: rep.decimals });

  process.stdout.write(`every quote, ranked by net user output (whole request ${quoteMs}ms at the production 6s deadline):\n`);
  const ranked = result.best ? [result.best, ...result.alternatives] : result.alternatives;
  for (const q of ranked) {
    const verdict = guarded.verdicts.find((v) => v.quote.venue === q.venue && v.quote.poolAddress === q.poolAddress);
    process.stdout.write(
      `  ${q.venue.padEnd(10)} ${ui(q.netOutput, decimals).padStart(14)}  impact ${String(q.priceImpactBps ?? "?").padStart(5)}bps  ` +
        `${String(result.latencyMs[q.venue] ?? "?").padStart(5)}ms  ` +
        `pool ${(q.poolAddress ?? "-").slice(0, 8)}  ${verdict ? (verdict.approved ? `APPROVED ${capabilityOf(verdict)}` : `REFUSED ${verdict.reason}`) : "no verdict"}\n`,
    );
  }
  for (const x of result.exclusions) process.stdout.write(`  ${x.venue.padEnd(10)} ${"-".padStart(14)}  EXCLUDED ${x.reason}${x.detail ? `: ${x.detail}` : ""}\n`);

  process.stdout.write("\nsplit optimizer:\n");
  if (!result.route) {
    process.stdout.write("  no split route returned (optimizer found nothing better than the best single venue)\n");
  } else {
    const r = result.route;
    process.stdout.write(`  kind ${r.kind}  legs ${r.legs.length}  net ${ui(r.netOutput, decimals)}  improvement ${r.improvementBps ?? "-"} bps  cost ${r.costBps} bps  reason ${r.reason}\n`);
    for (const leg of r.legs)
      process.stdout.write(`    leg ${leg.venue.padEnd(9)} pool ${(leg.poolAddress ?? "-").slice(0, 8)} in ${leg.swapInput} out ${ui(leg.netOutput, decimals)}\n`);
  }

  /* The engine's split optimizer compares a split against the best Raydium or
     Orca pool, never against Jupiter, and only returns one that clears the
     5 bps improvement threshold. To answer whether ANY split beats Jupiter,
     compute the unconstrained optimum here: same curves, no improvement
     threshold and no leg penalty. This reads the curves and changes no
     routing mathematics. */
  process.stdout.write("\nunconstrained split analysis (no improvement threshold, no leg penalty):\n");
  const feeIn = (amount * BigInt(MARKET_FEE_BPS)) / 10_000n;
  const venueAmount = side === "buy" ? amount - feeIn : amount;
  const venueRequest: QuoteRequest = { ...request, amount: venueAmount.toString() };
  const curveCtx = { connection, pools, now: Date.now(), deadlineMs: 60_000 };
  const curves: VenueCurve[] = [];
  for (const pool of pools) {
    const adapter = adapters.find((a) => a.venue === pool.venue);
    if (!adapter?.curve) continue;
    try {
      const curve = await adapter.curve(venueRequest, pool, curveCtx);
      if (curve) curves.push(curve);
    } catch (error) {
      process.stdout.write(`  curve ${pool.venue} ${pool.address.slice(0, 8)} failed: ${(error as Error).message}\n`);
    }
  }
  process.stdout.write(`  curves available: ${curves.length} (${curves.map((c) => `${c.venue}/${(c.poolAddress ?? "-").slice(0, 6)}${c.available ? "" : ":unavailable"}`).join(", ")})\n`);
  if (curves.length >= 2) {
    for (const maxLegs of [2, 3]) {
      for (const granularity of [20, 50]) {
        const split = optimizeSplit(curves, venueAmount, { ...DEFAULT_SPLIT_OPTIONS, maxLegs, granularity });
        const netOut = split.kind === "split" ? BigInt(split.totalOut) : split.bestSingleOut ? BigInt(split.bestSingleOut) : 0n;
        const label = split.kind === "split"
          ? split.legs.map((l) => `${Math.round((Number(l.amountIn) / Number(venueAmount)) * 100)}% ${l.venue}/${(l.poolAddress ?? "-").slice(0, 6)}`).join(" + ")
          : `single ${split.bestSingleVenue ?? "-"}`;
        process.stdout.write(
          `  maxLegs ${maxLegs} granularity ${String(granularity).padStart(2)}: ${ui(netOut.toString(), decimals).padStart(14)}  ` +
            `vs best single ${split.bestSingleOut ? ui(split.bestSingleOut, decimals) : "-"}  improvement ${split.improvementBps ?? 0} bps  ${label}\n`,
        );
      }
    }
    const jupQuote = ranked.find((q) => q.venue === "jupiter");
    if (jupQuote) {
      const best = optimizeSplit(curves, venueAmount, { ...DEFAULT_SPLIT_OPTIONS, maxLegs: 3, granularity: 50 });
      const splitNet = best.kind === "split" ? BigInt(best.totalOut) : best.bestSingleOut ? BigInt(best.bestSingleOut) : 0n;
      const jupNet = BigInt(jupQuote.netOutput);
      const diff = jupNet > 0n ? Number(((splitNet - jupNet) * 1_000_000n) / jupNet) / 100 : null;
      process.stdout.write(
        `\n  best Henar construction ${ui(splitNet.toString(), decimals)} vs Jupiter ${ui(jupQuote.netOutput, decimals)} -> ${diff === null ? "?" : `${diff > 0 ? "+" : ""}${diff.toFixed(2)} bps`}\n`,
      );
      process.stdout.write(`  ${splitNet > jupNet ? "A Henar split BEATS Jupiter" : "No split beats Jupiter for this request"}\n`);
    }
  } else {
    process.stdout.write("  fewer than two curves: no split is possible for this request\n");
  }

  const selected = selectRoute(guarded.verdicts);
  process.stdout.write(`\nselection: ${selected ? `${selected.quote.venue} (${capabilityOf(selected)}) net ${ui(selected.quote.netOutput, decimals)}` : "nothing executable"}\n`);
  const approved = guarded.verdicts.filter((v) => v.approved);
  const bestApproved = approved.length ? approved.reduce((a, b) => (BigInt(b.quote.netOutput) > BigInt(a.quote.netOutput) ? b : a)) : null;
  process.stdout.write(`best observed (approved, any capability): ${bestApproved ? `${bestApproved.quote.venue} net ${ui(bestApproved.quote.netOutput, decimals)}` : "none"}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
