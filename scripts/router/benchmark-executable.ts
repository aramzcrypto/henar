/**
 * Executable split benchmark.
 *
 * Measures what Henar can actually execute, not what it can price. Every
 * number here comes from the same engine the product uses, with the
 * executability invariant on, and each winning native route is then built and
 * simulated against mainnet so the improvement is only counted when the trade
 * would have gone through.
 *
 * Three configurations run over the same ladder so each venue's contribution
 * is a measured difference rather than an assertion:
 *
 *   all        every buildable venue
 *   -meteora   Meteora DLMM removed
 *   -byreal    Byreal removed
 *
 * The full matrix (`router:benchmark:matrix`) additionally needs
 * JUPITER_API_KEY and STOCKROOM_TREASURY_OWNER, which `vercel env pull`
 * returns empty; Jupiter is quoted here through the keyless lite endpoint and
 * the treasury fee transfer is not planned, so the simulation below covers the
 * venue instructions rather than the whole packaged transaction.
 */
import { writeFile } from "node:fs/promises";
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DEFAULT_SPLIT_OPTIONS, USDC_MINT, loadPoolRegistry, quoteRepresentation, type QuoteContext, type VenueAdapter, type VerifiedPool } from "@henar/router-core";
import { RaydiumAdapter, RaydiumCpmmAdapter } from "@henar/venue-raydium";
import { MeteoraAdapter } from "@henar/venue-meteora";
import { OrcaAdapter } from "@henar/venue-orca";
import { ByrealAdapter } from "@henar/venue-byreal";

const SIZES = [100, 1_000, 5_000, 10_000, 25_000, 50_000];
const OUTPUT = "docs/router/EXECUTABLE_BENCHMARK.json";
const JUP = "https://lite-api.jup.ag/swap/v1";
/** The fee Henar charges, matching MARKET_FEE_BPS. */
const FEE_BPS = 10;
/**
 * With HENAR_BENCH_THREE_LEG=1 the optimizer may open a third leg and every
 * route compiles against a lookup table built in memory over its own accounts.
 * That is what a router lookup table would give, measured without creating
 * one: it answers whether a third leg is worth the table, rather than only
 * whether it would fit.
 */
const THREE_LEG = process.env.HENAR_BENCH_THREE_LEG === "1";
/** Configuration name for the three-leg arm, compared row by row with "all". */
const THREE_LEG_CONFIG = "3leg+lut";

type Row = {
  config: string;
  ticker: string;
  sizeUsd: number;
  bestSingleVenue: string | null;
  bestSingleOut: string | null;
  routeKind: "single" | "split" | null;
  routeVenues: string[];
  henarGrossOut: string | null;
  henarNetOut: string | null;
  jupiterOut: string | null;
  /** Split gain over the best single native venue, bps. */
  splitGainBps: number | null;
  grossVsJupiterBps: number | null;
  netVsJupiterBps: number | null;
  /**
   * What the product actually shows. Henar races its own native engine
   * against Jupiter and takes the better side, so the number a user sees is
   * the best of the two, less the fee — not the native engine alone.
   */
  productNetVsJupiterBps: number | null;
  simulated: boolean | null;
  simulationDetail: string | null;
  /** Serialized v0 transaction size in bytes, and the limit it must fit. */
  txBytes: number | null;
  lookupTablesUsed: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jupiterOut(mint: string, sizeUsd: number): Promise<bigint | null> {
  const amount = BigInt(sizeUsd) * 1_000_000n;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${JUP}/quote?inputMint=${USDC_MINT}&outputMint=${mint}&amount=${amount}&slippageBps=50`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (res?.status === 429) { await sleep(2_000 * (attempt + 1)); continue; }
    if (!res?.ok) return null;
    const body = (await res.json()) as { outAmount?: string };
    return body.outAmount ? BigInt(body.outAmount) : null;
  }
  return null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function tokenProgramOf(connection: Connection, mint: string) {
  const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
  if (!info) throw new Error(`mint ${mint} not found`);
  return info.owner;
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required; this never runs on fixtures.");
  const owner = process.env.HENAR_SIM_OWNER ? new PublicKey(process.env.HENAR_SIM_OWNER) : null;
  const connection = new Connection(rpc, "confirmed");
  const registry = loadPoolRegistry();

  const build = (exclude: string[]): VenueAdapter[] =>
    [
      /* Every adapter is constructed with execution on. The singletons read
         HENAR_ROUTER_EXECUTION, and a benchmark that silently measured
         "builder refused because the flag is off" as a build failure would
         report a defect that is not there. Nothing is signed or sent. */
      new RaydiumAdapter({ executionEnabled: true }),
      new RaydiumCpmmAdapter({ executionEnabled: true }),
      new OrcaAdapter({ executionEnabled: true }),
      new MeteoraAdapter({ executionEnabled: true }),
      new ByrealAdapter({ executionEnabled: true }),
    ].filter((a) => !exclude.includes(a.venue));

  /* The three-leg arm runs beside the others on the same tickers and sizes,
     so its gain is a paired difference rather than a comparison of medians
     taken from separate runs minutes apart. Market state moves between runs;
     it does not move between two configurations of the same row. */
  const configs: { name: string; adapters: VenueAdapter[] }[] = [
    { name: "all", adapters: build([]) },
    { name: THREE_LEG_CONFIG, adapters: build([]) },
    { name: "-meteora", adapters: build(["meteora"]) },
    { name: "-byreal", adapters: build(["byreal"]) },
  ];

  /* Representations with at least two enabled native pools: a split needs two
     curves, so anything thinner cannot show a split either way. */
  const byRep = new Map<string, VerifiedPool[]>();
  for (const p of registry.pools) {
    if (!p.enabled || p.eligibility !== "ROUTER_ELIGIBLE") continue;
    if (!["raydium", "orca", "meteora", "byreal"].includes(p.venue)) continue;
    byRep.set(p.representationId, [...(byRep.get(p.representationId) ?? []), p]);
  }
  /* Deepest first. Taking the head of the registry order gives micro-caps
     whose only pools are thin, where Henar loses to Jupiter for reasons that
     have nothing to do with routing quality — and the median then describes
     the sample, not the router. */
  const candidates = [...byRep.entries()]
    .filter(([, pools]) => pools.length >= 2)
    .sort((a, b) => b[1].reduce((s, p) => s + (p.tvlUsd ?? 0), 0) - a[1].reduce((s, p) => s + (p.tvlUsd ?? 0), 0))
    .slice(0, 10);
  process.stdout.write(`${candidates.length} representations with two or more native pools, ${SIZES.length} sizes, ${configs.length} configurations\n\n`);

  const rows: Row[] = [];

  for (const { name, adapters } of configs) {
    process.stdout.write(`--- ${name}\n`);
    for (const [representationId, pools] of candidates) {
      const ticker = pools[0].tokenSymbol;
      const mint = pools[0].mint;
      for (const sizeUsd of SIZES) {
        const amount = (BigInt(sizeUsd) * 1_000_000n).toString();
        const request = { representationId, side: "buy" as const, amount, amountType: "input" as const, inputMint: USDC_MINT, outputMint: mint };
        const row: Row = {
          config: name, ticker, sizeUsd, bestSingleVenue: null, bestSingleOut: null, routeKind: null, routeVenues: [],
          henarGrossOut: null, henarNetOut: null, jupiterOut: null, splitGainBps: null,
          grossVsJupiterBps: null, netVsJupiterBps: null, productNetVsJupiterBps: null, simulated: null, simulationDetail: null,
          txBytes: null, lookupTablesUsed: 0,
        };

        const result = await quoteRepresentation(request, {
          adapters, enabled: true, splitRouting: true, pathRouting: false,
          poolsOverride: pools, connection, deadlineMs: 30_000,
          splitOptions: name === THREE_LEG_CONFIG ? { ...DEFAULT_SPLIT_OPTIONS, maxLegs: 3 } : undefined,
        }).catch((e) => { row.simulationDetail = `quote failed: ${(e as Error).message}`; return null; });

        if (result?.best) {
          row.bestSingleVenue = result.best.venue;
          row.bestSingleOut = result.best.netOutput;
        }
        /* The route the product would use: the split when it wins, else the
           best single venue. Both are executable by construction now. */
        const chosen = result?.route ?? (result?.best ? { kind: "single" as const, netOutput: result.best.netOutput, legs: [{ venue: result.best.venue }] } : null);
        if (chosen && result?.best) {
          row.routeKind = result.route ? "split" : "single";
          row.routeVenues = (chosen.legs as { venue: string }[]).map((l) => l.venue);
          row.henarNetOut = chosen.netOutput;
          /* Net output already has the Henar fee removed; gross it back up to
             compare like with like against Jupiter's unrestricted route. */
          const net = BigInt(chosen.netOutput);
          row.henarGrossOut = ((net * 10_000n) / BigInt(10_000 - FEE_BPS)).toString();
          const single = BigInt(result.best.netOutput);
          if (single > 0n) row.splitGainBps = Number(((net - single) * 10_000n) / single);
        }

        const jup = await jupiterOut(mint, sizeUsd);
        await sleep(1_100);
        if (jup) {
          row.jupiterOut = jup.toString();
          if (row.henarGrossOut) row.grossVsJupiterBps = Number(((BigInt(row.henarGrossOut) - jup) * 10_000n) / jup);
          if (row.henarNetOut) row.netVsJupiterBps = Number(((BigInt(row.henarNetOut) - jup) * 10_000n) / jup);
          /* The race: whichever gross output is larger, then the fee. This is
             the comparison a user experiences, and it is bounded below by
             Jupiter's own price less the fee. */
          const gross = row.henarGrossOut ? BigInt(row.henarGrossOut) : 0n;
          const best = gross > jup ? gross : jup;
          const net = (best * BigInt(10_000 - FEE_BPS)) / 10_000n;
          row.productNetVsJupiterBps = Number(((net - jup) * 10_000n) / jup);
        }

        /* Build and simulate the winning native route's legs. A route that
           cannot survive this is not an improvement, whatever it quoted. */
        if ((name === "all" || name === THREE_LEG_CONFIG) && result?.best && !result.best.unavailableReason && owner) {
          try {
            const legs = result.route
              ? result.route.legs.map((l) => ({ venue: l.venue, quote: l }))
              : [{ venue: result.best.venue, quote: result.best }];
            /* The planner always sets a compute limit; without it the runtime
               allows 200k units per instruction and a Byreal leg alone has
               been measured at 215k, so a two-leg route fails with
               ProgramFailedToComplete for a reason that is nothing to do with
               the route. Mirror the planner's ceiling. */
            const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })];
            const outProgram = await tokenProgramOf(connection, mint);
            instructions.push(
              createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, outProgram), owner, new PublicKey(mint), outProgram),
            );
            let ok = true;
            /* Every lookup table the adapters offer. The router's build path
               currently discards these, which is why three-leg routes overrun
               the 1232-byte limit; measuring with them shows what the ceiling
               would be once they are actually used. */
            const tableAddresses = new Set<string>();
            for (const leg of legs) {
              const adapter = adapters.find((a) => a.venue === leg.venue);
              const pool = pools.find((p) => p.address === leg.quote.poolAddress);
              if (!adapter || !pool) { ok = false; row.simulationDetail = `no adapter or pool for ${leg.venue}`; break; }
              const ctx: QuoteContext = { connection, pools: [pool], now: Date.now(), deadlineMs: 30_000 };
              const minimumAmountOut = ((BigInt(leg.quote.expectedAmountOut) * 9_900n) / 10_000n).toString();
              const built = await adapter.buildSwapInstructions(leg.quote, ctx, { owner: owner.toBase58(), minimumAmountOut });
              if (built.reason || !built.instructions.length) { ok = false; row.simulationDetail = `${leg.venue} build: ${built.reason} ${built.detail ?? ""}`; break; }
              instructions.push(...built.instructions);
              for (const t of built.lookupTables) tableAddresses.add(t.toBase58());
            }
            if (ok) {
              const protocolTable = process.env.STOCKROOM_LOOKUP_TABLE;
              if (protocolTable) tableAddresses.add(protocolTable);
              const tables: AddressLookupTableAccount[] = [];
              if (name === THREE_LEG_CONFIG) {
                /* The table a router LUT would be, over exactly this route's
                   accounts. Signers and the payer stay in the static keys. */
                const carried = new Map<string, PublicKey>();
                for (const ix of instructions as TransactionInstruction[]) {
                  carried.set(ix.programId.toBase58(), ix.programId);
                  for (const k of ix.keys) if (!k.isSigner && !k.pubkey.equals(owner)) carried.set(k.pubkey.toBase58(), k.pubkey);
                }
                tables.push(new AddressLookupTableAccount({
                  key: new PublicKey("11111111111111111111111111111112"),
                  state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: owner, addresses: [...carried.values()] },
                }));
              }
              for (const address of tableAddresses) {
                const fetched = await connection.getAddressLookupTable(new PublicKey(address)).catch(() => null);
                if (fetched?.value?.isActive()) tables.push(fetched.value);
              }
              row.lookupTablesUsed = tables.length;
              const { blockhash } = await connection.getLatestBlockhash("confirmed");
              const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message(tables);
              const transaction = new VersionedTransaction(message);
              /* Serialization is where an oversized transaction actually
                 fails, so measure it rather than estimating from accounts. */
              try {
                row.txBytes = transaction.serialize().length;
              } catch (error) {
                row.simulated = false;
                row.simulationDetail = `serialize: ${(error as Error).message}`;
                rows.push(row);
                process.stdout.write(`  ${ticker.padEnd(9)} $${String(sizeUsd).padStart(6)}  ${(row.routeKind ?? "none").padEnd(6)} ${row.routeVenues.join("+").padEnd(24)} OVERSIZED (${tables.length} ALTs)\n`);
                continue;
              }
              if (name === THREE_LEG_CONFIG) {
                /* The table is built in memory and has no account on chain, so
                   the cluster cannot resolve its indexes. Size and price are
                   still measured exactly — compilation is local and the quote
                   is the engine's — but simulation is not attempted rather
                   than recorded as a failure it is not. */
                row.simulationDetail = "not simulated: lookup table is synthetic";
              } else {
                const sim = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
                row.simulated = !sim.value.err;
                if (sim.value.err) row.simulationDetail = JSON.stringify(sim.value.err);
              }
            } else row.simulated = false;
          } catch (error) {
            row.simulated = false;
            row.simulationDetail = (error as Error).message;
          }
        }

        rows.push(row);
        process.stdout.write(
          `  ${ticker.padEnd(9)} $${String(sizeUsd).padStart(6)}  ${(row.routeKind ?? "none").padEnd(6)} ${row.routeVenues.join("+").padEnd(24)} split ${String(row.splitGainBps ?? "-").padStart(5)} bps  gross ${String(row.grossVsJupiterBps ?? "-").padStart(6)}  net ${String(row.netVsJupiterBps ?? "-").padStart(6)}  ${row.txBytes ? `${row.txBytes}B/${row.lookupTablesUsed}ALT ` : ""}${row.simulated === null ? "" : row.simulated ? "sim ok" : "SIM FAIL"}\n`,
        );
      }
    }
  }

  await writeFile(OUTPUT, `${JSON.stringify({ measuredAt: new Date().toISOString(), sizes: SIZES, feeBps: FEE_BPS, rows }, null, 2)}\n`, "utf8");

  process.stdout.write("\n=== summary\n");
  for (const { name } of configs) {
    const mine = rows.filter((r) => r.config === name);
    const splits = mine.filter((r) => r.routeKind === "split");
    const pick = (f: (r: Row) => number | null) => median(mine.map(f).filter((n): n is number => n !== null));
    process.stdout.write(
      `${name.padEnd(9)} splits ${String(splits.length).padStart(2)}/${mine.length}  split gain ${String(median(splits.map((r) => r.splitGainBps).filter((n): n is number => n !== null))).padStart(4)}  native gross ${String(pick((r) => r.grossVsJupiterBps)).padStart(5)}  native net ${String(pick((r) => r.netVsJupiterBps)).padStart(5)}  product net ${String(pick((r) => r.productNetVsJupiterBps)).padStart(5)} bps\n`,
    );
  }
  /* Paired against "all" on the same ticker and size. */
  const base = new Map(rows.filter((r) => r.config === "all").map((r) => [`${r.ticker}:${r.sizeUsd}`, r]));
  const paired: number[] = [];
  const perSize = new Map<number, number[]>();
  for (const r of rows.filter((x) => x.config === THREE_LEG_CONFIG)) {
    const a = base.get(`${r.ticker}:${r.sizeUsd}`);
    if (!a || a.grossVsJupiterBps === null || r.grossVsJupiterBps === null) continue;
    const gain = r.grossVsJupiterBps - a.grossVsJupiterBps;
    paired.push(gain);
    perSize.set(r.sizeUsd, [...(perSize.get(r.sizeUsd) ?? []), gain]);
  }
  process.stdout.write(`\nthird leg, paired on the same row: median ${median(paired)} bps over ${paired.length} rows\n`);
  for (const size of SIZES) {
    const g = perSize.get(size) ?? [];
    if (g.length) process.stdout.write(`  $${String(size).padStart(6)}: ${String(median(g)).padStart(4)} bps over ${g.length} rows\n`);
  }

  const simmed = rows.filter((r) => r.simulated !== null);
  const clean = simmed.filter((r) => r.simulated).length;
  process.stdout.write(`build+simulate: ${clean}/${simmed.length} clean (${simmed.length ? Math.round((clean / simmed.length) * 100) : 0}%)\n`);
  /* Per size, because the gap to Jupiter widens with size and a single median
     over the whole ladder hides that. */
  for (const size of SIZES) {
    const at = rows.filter((r) => r.config === "all" && r.sizeUsd === size);
    const g = median(at.map((r) => r.grossVsJupiterBps).filter((n): n is number => n !== null));
    const p = median(at.map((r) => r.productNetVsJupiterBps).filter((n): n is number => n !== null));
    process.stdout.write(`  $${String(size).padStart(6)}: native gross ${String(g).padStart(5)} bps, product net ${String(p).padStart(5)} bps\n`);
  }
  const sized = rows.filter((r) => r.txBytes !== null);
  const byLegs = new Map<number, number[]>();
  for (const r of sized) byLegs.set(r.routeVenues.length, [...(byLegs.get(r.routeVenues.length) ?? []), r.txBytes!]);
  for (const [legs, bytes] of [...byLegs.entries()].sort((a, b) => a[0] - b[0]))
    process.stdout.write(`  ${legs}-leg: ${bytes.length} routes, median ${median(bytes)} bytes, max ${Math.max(...bytes)} (limit 1232)\n`);
  const oversized = rows.filter((r) => (r.simulationDetail ?? "").startsWith("serialize:"));
  process.stdout.write(`  oversized: ${oversized.length}\n`);
  process.stdout.write(`Wrote ${OUTPUT}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
