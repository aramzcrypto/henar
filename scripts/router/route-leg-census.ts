/**
 * Route-leg census: which venues actually carry Henar's flow.
 *
 * The reconnaissance that found "roughly a third of the flow runs through
 * venues Henar has no adapter for" counted legs by hand across 84 routes and
 * kept nothing. This measures the same thing and writes it down, because it is
 * the frequency term in deciding which opaque venue is worth an adapter: a
 * venue that prices well but almost never wins a leg is not worth building.
 *
 * For each equity and order size it takes Jupiter's unrestricted route — the
 * one a user would actually get — and records every leg in its routePlan with
 * the share of input that leg carried. A venue's weight is therefore the flow
 * it moves, not the number of pools it has.
 *
 * `covered` is the set of venues Henar can already quote natively. Everything
 * else is the gap this measures.
 */
import { writeFile } from "node:fs/promises";
import { equityRegistry } from "../../src/lib/equities/registry";
import poolsJson from "../../src/data/router/pools.json";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "https://lite-api.jup.ag/swap/v1";
const OUTPUT = "src/data/router/route-leg-census.json";
const SIZES = [100, 1_000, 5_000, 10_000, 25_000, 50_000];
const RATE_MS = 1_100;

/**
 * Venues Henar quotes natively today, as Jupiter labels them. This is the
 * enabled pool registry and nothing more — Jupiter also labels "Raydium"
 * (AMM v4), "Orca V2", "Meteora" (dynamic AMM) and "Meteora DAMM v2", none of
 * which Henar has an enabled pool for. Listing them here would quietly shrink
 * the measured gap, which is the opposite of the point.
 */
const COVERED = new Set(["Raydium CLMM", "Raydium CP", "Whirlpool", "Meteora DLMM", "Byreal"]);

type Leg = {
  label: string;
  sizeUsd: number;
  ticker: string;
  shareOfInput: number;
  /** True when this leg actually moves the equity, false when it is a hop
      between intermediates (USDC -> SOL and the like). */
  touchesEquity: boolean;
  hops: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (res?.status === 429) {
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (!res?.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  }
  return null;
}

async function main() {
  const pools = poolsJson as { mint: string; tokenSymbol: string; enabled: boolean; provider: string }[];
  const tradable = new Map<string, string>();
  for (const p of pools) {
    if (!p.enabled || p.provider === "prestocks" || p.provider === "tessera") continue;
    if (!tradable.has(p.tokenSymbol)) tradable.set(p.tokenSymbol, p.mint);
  }
  const known = new Set(equityRegistry.flatMap((e) => e.representations.map((r) => r.mint)));
  const probes = [...tradable.entries()].filter(([, mint]) => known.has(mint));

  process.stdout.write(`Censusing winning routes: ${probes.length} equities x ${SIZES.length} sizes…\n`);
  const legs: Leg[] = [];
  let routes = 0;

  for (const [ticker, mint] of probes) {
    for (const sizeUsd of SIZES) {
      const amount = BigInt(sizeUsd) * 1_000_000n;
      const q = await getJson(`${JUP}/quote?inputMint=${USDC}&outputMint=${mint}&amount=${amount}&slippageBps=50`);
      await sleep(RATE_MS);
      type Step = { swapInfo?: { label?: string; inputMint?: string; outputMint?: string }; percent?: number };
      const plan = q?.routePlan as Step[] | undefined;
      if (!plan?.length) continue;
      routes += 1;
      for (const step of plan) {
        const label = step.swapInfo?.label;
        if (!label) continue;
        /* Whether the leg carries the equity itself is the whole question for
           adapter work: a venue that only ever moves USDC to SOL on the way to
           the equity is a routing-intermediate finding, not an equity-liquidity
           finding, and an equity adapter for it would quote nothing. */
        const touchesEquity = step.swapInfo?.inputMint === mint || step.swapInfo?.outputMint === mint;
        legs.push({ label, sizeUsd, ticker, shareOfInput: (step.percent ?? 0) / 100, touchesEquity, hops: plan.length });
      }
    }
  }

  /* Weight by share of input rather than by leg count: a venue taking 5% of
     forty routes is not the same finding as one taking 60% of ten. */
  type Row = {
    label: string; covered: boolean; legs: number; equityLegs: number;
    flowWeight: number; equityFlowWeight: number; routes: Set<string>;
    bySize: Record<number, number>; equityTickers: Set<string>;
  };
  const rows = new Map<string, Row>();
  for (const leg of legs) {
    let row = rows.get(leg.label);
    if (!row) {
      row = {
        label: leg.label, covered: COVERED.has(leg.label), legs: 0, equityLegs: 0,
        flowWeight: 0, equityFlowWeight: 0, routes: new Set(), bySize: {}, equityTickers: new Set(),
      };
      rows.set(leg.label, row);
    }
    row.legs += 1;
    row.flowWeight += leg.shareOfInput;
    if (leg.touchesEquity) {
      row.equityLegs += 1;
      row.equityFlowWeight += leg.shareOfInput;
      row.equityTickers.add(leg.ticker);
    }
    row.routes.add(`${leg.ticker}:${leg.sizeUsd}`);
    row.bySize[leg.sizeUsd] = (row.bySize[leg.sizeUsd] ?? 0) + leg.shareOfInput;
  }

  const ranked = [...rows.values()]
    .map((r) => ({
      label: r.label,
      covered: r.covered,
      legs: r.legs,
      equityLegs: r.equityLegs,
      /* Share of all routed flow across the whole probe set. */
      flowSharePct: Math.round((r.flowWeight / Math.max(routes, 1)) * 1000) / 10,
      /* The share that actually moves the equity. Where this is zero the venue
         is a routing intermediate and an equity adapter for it is pointless. */
      equityFlowSharePct: Math.round((r.equityFlowWeight / Math.max(routes, 1)) * 1000) / 10,
      /* The equities this venue was seen carrying. The opaque-venue harness
         probes each venue here rather than on a fixed slice of the ticker
         list, which is what stops a two-pool venue reading as having none. */
      tickers: [...r.equityTickers].sort(),
      routesTouched: r.routes.size,
      routeSharePct: Math.round((r.routes.size / Math.max(routes, 1)) * 1000) / 10,
      flowBySizeUsd: r.bySize,
    }))
    .sort((a, b) => b.flowSharePct - a.flowSharePct);

  const uncovered = ranked.filter((r) => !r.covered);
  const gapShare = Math.round(uncovered.reduce((s, r) => s + r.flowSharePct, 0) * 10) / 10;
  const equityGapShare = Math.round(uncovered.reduce((s, r) => s + r.equityFlowSharePct, 0) * 10) / 10;

  await writeFile(
    OUTPUT,
    `${JSON.stringify({ measuredAt: new Date().toISOString(), sizes: SIZES, routes, tickers: probes.length, uncoveredFlowSharePct: gapShare, uncoveredEquityFlowSharePct: equityGapShare, venues: ranked }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`\n${routes} winning routes, ${legs.length} legs\n\n`);
  process.stdout.write(`${"venue".padEnd(20)} ${"flow%".padStart(6)} ${"equity%".padStart(8)} ${"routes%".padStart(8)}  covered\n`);
  for (const r of ranked.slice(0, 25)) {
    process.stdout.write(
      `${r.label.padEnd(20)} ${String(r.flowSharePct).padStart(6)} ${String(r.equityFlowSharePct).padStart(8)} ${String(r.routeSharePct).padStart(8)}  ${r.covered ? "yes" : "NO"}\n`,
    );
  }
  process.stdout.write(`\nFlow through venues Henar cannot quote: ${gapShare}% overall, ${equityGapShare}% on the equity leg itself\nWrote ${OUTPUT}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
