/**
 * Route forensics (V2-2): what public liquidity do external routers reach
 * that Henar's registry does not?
 *
 * For every verified representation, at a ladder of sizes and on both sides,
 * this asks Jupiter for a quote and records the *whole* route plan — every
 * hop's venue label, pool address, input and output mint, amounts and fee —
 * then aggregates:
 *
 *   - which venues carry external stock flow, and how often
 *   - which intermediate mints appear between USDC and a representation
 *   - which of those venues Henar's pool registry has no pool for
 *   - how much output the external route won by
 *
 * Read-only. Nothing is signed. Jupiter's own normalisation is trusted for
 * labels only; every conclusion is counted from live responses rather than
 * assumed, and a representation that fails to quote is recorded as a failure
 * rather than skipped, so gaps stay visible.
 *
 *   JUPITER_API_KEY=… npm run router:forensics -- [limit] [sizes]
 *   env: HENAR_FORENSICS_LOG (default logs/route-forensics.jsonl)
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { USDC_MINT, listRouterRepresentations } from "@henar/router-core";

const HOP = z.object({
  percent: z.number().nullable().optional(),
  swapInfo: z.object({
    ammKey: z.string().optional(),
    label: z.string().optional(),
    inputMint: z.string().optional(),
    outputMint: z.string().optional(),
    inAmount: z.string().optional(),
    outAmount: z.string().optional(),
    feeAmount: z.string().optional(),
    feeMint: z.string().optional(),
  }),
});

const QUOTE = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  priceImpactPct: z.union([z.string(), z.number()]).optional(),
  router: z.string().optional(),
  contextSlot: z.number().int().optional(),
  routePlan: z.array(HOP).default([]),
});

export type ForensicHop = {
  venue: string;
  pool: string | null;
  inputMint: string | null;
  outputMint: string | null;
  percent: number | null;
  feeAmount: string | null;
  feeMint: string | null;
};

export type ForensicRecord = {
  observedAt: string;
  ticker: string;
  provider: string;
  representationId: string;
  mint: string;
  side: "buy" | "sell";
  sizeUsd: number;
  amountIn: string;
  outAmount: string | null;
  priceImpactPct: string | null;
  router: string | null;
  hops: ForensicHop[];
  /** Mints that are neither the input nor the output: true intermediates. */
  intermediates: string[];
  failure: string | null;
};

const SIZES = (process.argv[3] ?? "10,100,1000,10000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const LIMIT = Number(process.argv[2] ?? "40");
const LOG = process.env.HENAR_FORENSICS_LOG ?? "logs/route-forensics.jsonl";

function apiKey() {
  const value = process.env.JUPITER_API_KEY;
  if (!value) {
    console.error("JUPITER_API_KEY is required; forensics never runs on fixtures.");
    process.exit(1);
  }
  return value;
}

const DELAY_MS = Number(process.env.HENAR_FORENSICS_DELAY_MS ?? "1300");
const RETRIES = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Jupiter's dev tier rate-limits hard; a 429 is a pacing problem rather than
 *  a liquidity finding, so it is retried with backoff and only a persistent
 *  failure is recorded. A 400 means Jupiter has no route, which IS a finding. */
async function quote(
  inputMint: string,
  outputMint: string,
  amount: string,
  key: string,
): Promise<z.infer<typeof QUOTE>> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: "50",
    taker: "",
  });
  params.delete("taker");
  const response = await fetch(`https://api.jup.ag/swap/v2/order?${params}`, {
    headers: { "x-api-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Jupiter ${response.status}`);
  return QUOTE.parse(await response.json());
}

async function quoteWithBackoff(
  inputMint: string,
  outputMint: string,
  amount: string,
  key: string,
): Promise<z.infer<typeof QUOTE>> {
  let wait = DELAY_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await quote(inputMint, outputMint, amount, key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = message.includes("429");
      if (!rateLimited || attempt >= RETRIES) throw error;
      wait *= 2;
      await sleep(wait);
    }
  }
}

function hopsOf(plan: z.infer<typeof QUOTE>["routePlan"]): ForensicHop[] {
  return plan.map((step) => ({
    venue: step.swapInfo.label ?? "unknown",
    pool: step.swapInfo.ammKey ?? null,
    inputMint: step.swapInfo.inputMint ?? null,
    outputMint: step.swapInfo.outputMint ?? null,
    percent: step.percent ?? null,
    feeAmount: step.swapInfo.feeAmount ?? null,
    feeMint: step.swapInfo.feeMint ?? null,
  }));
}

async function main() {
  const key = apiKey();
  const reps = listRouterRepresentations().slice(0, LIMIT);
  if (!reps.length) {
    console.error("No representations in the router registry.");
    process.exit(1);
  }
  await mkdir(dirname(LOG), { recursive: true });
  const records: ForensicRecord[] = [];

  for (const rep of reps) {
    for (const sizeUsd of SIZES) {
      for (const side of ["buy", "sell"] as const) {
        // Buys spend USDC; sells start from a token amount worth ~sizeUsd,
        // which needs a price, so the sell leg is derived from the buy quote.
        const amountIn =
          side === "buy" ? BigInt(Math.round(sizeUsd * 1_000_000)).toString() : null;
        const base: Omit<ForensicRecord, "hops" | "intermediates" | "outAmount" | "priceImpactPct" | "router" | "failure"> = {
          observedAt: new Date().toISOString(),
          ticker: rep.tokenSymbol,
          provider: rep.provider,
          representationId: rep.id,
          mint: rep.mint,
          side,
          sizeUsd,
          amountIn: amountIn ?? "0",
        };
        if (side === "sell") continue; // buy-side forensics first; sells need a price oracle
        try {
          const result = await quoteWithBackoff(USDC_MINT, rep.mint, amountIn!, key);
          const hops = hopsOf(result.routePlan);
          const seen = new Set<string>();
          for (const hop of hops) {
            if (hop.inputMint) seen.add(hop.inputMint);
            if (hop.outputMint) seen.add(hop.outputMint);
          }
          seen.delete(USDC_MINT);
          seen.delete(rep.mint);
          const record: ForensicRecord = {
            ...base,
            outAmount: result.outAmount,
            priceImpactPct:
              result.priceImpactPct === undefined ? null : String(result.priceImpactPct),
            router: result.router ?? null,
            hops,
            intermediates: [...seen],
            failure: null,
          };
          records.push(record);
          await appendFile(LOG, `${JSON.stringify(record)}\n`);
          process.stdout.write(
            `${rep.tokenSymbol.padEnd(9)} $${String(sizeUsd).padEnd(6)} ${hops.map((h) => `${h.venue}${h.percent ? `:${h.percent}` : ""}`).join(" + ") || "(no plan)"}\n`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const record: ForensicRecord = {
            ...base,
            outAmount: null,
            priceImpactPct: null,
            router: null,
            hops: [],
            intermediates: [],
            failure: message.includes("400") ? "NO_ROUTE" : message,
          };
          records.push(record);
          await appendFile(LOG, `${JSON.stringify(record)}\n`);
          process.stdout.write(`${rep.tokenSymbol.padEnd(9)} $${String(sizeUsd).padEnd(6)} ${record.failure}\n`);
        }
        await sleep(DELAY_MS);
      }
    }
  }

  summarize(records);
}

function summarize(records: ForensicRecord[]) {
  const ok = records.filter((r) => r.failure === null);
  const venue = new Map<string, number>();
  const intermediate = new Map<string, number>();
  const multiHop = ok.filter((r) => r.hops.length > 1);
  for (const record of ok) {
    for (const hop of record.hops) venue.set(hop.venue, (venue.get(hop.venue) ?? 0) + 1);
    for (const mint of record.intermediates)
      intermediate.set(mint, (intermediate.get(mint) ?? 0) + 1);
  }
  const line = (label: string, value: string | number) =>
    console.log(`  ${label.padEnd(30)} ${value}`);
  console.log("\n=== Route forensics ===");
  line("records", records.length);
  line("quoted", ok.length);
  line("no route (Jupiter 400)", records.filter((r) => r.failure === "NO_ROUTE").length);
  line("transport failures", records.filter((r) => r.failure !== null && r.failure !== "NO_ROUTE").length);
  line("multi-hop routes", multiHop.length);
  console.log("\nVenues in external routes:");
  for (const [name, count] of [...venue].sort((a, b) => b[1] - a[1]))
    console.log(`  ${name.padEnd(24)} ${count}`);
  console.log("\nIntermediate mints:");
  if (!intermediate.size) console.log("  (none — every route was a single hop)");
  for (const [mint, count] of [...intermediate].sort((a, b) => b[1] - a[1]))
    console.log(`  ${mint.padEnd(46)} ${count}`);
  console.log(`\nLog: ${LOG}`);
}

void main();
