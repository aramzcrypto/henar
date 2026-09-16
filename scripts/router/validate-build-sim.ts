/**
 * Build + simulation gate for Henar Native routes.
 *
 * Quoting a good price proves nothing about being able to execute it. This
 * harness takes representative verified pools, runs the production pipeline
 * (quote -> guard -> select -> plan -> build -> simulate) against mainnet, and
 * reports the exact stage that refused. Nothing is signed and nothing is
 * submitted: simulation runs with sigVerify off.
 *
 *   HENAR_ROUTER_EXECUTION=1 npm run router:validate:build-sim
 *
 * The flag belongs in this process only. Enabling it for users is a separate
 * decision, and a route that cannot build or simulate must be treated as
 * non-selectable rather than counted as a Henar win.
 *
 * Simulation is only meaningful as an owner who actually holds the input
 * asset: an unfunded payer fails with InsufficientFunds and says nothing about
 * the route. The harness therefore finds a real holder whose tokens sit in a
 * plain associated token account and simulates as them. Nothing is signed,
 * nothing is submitted, and no funds can move.
 *
 * Pass `--assume-mint-facts` to supply decimals and token program from a live
 * mint read instead of the catalog. That does not persist anything; it
 * separates "blocked solely by unverified catalog facts" from "the build path
 * itself is broken", which are very different problems.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, unpackAccount, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  USDC_MINT,
  flagEnabled,
  inspectionFromAccount,
  loadPoolRegistry,
  poolByAddress,
  poolsForRepresentation,
  rankQuote,
  routerRepresentation,
  routerRepresentationForMint,
  type BuildOptions,
  type PlannedLeg,
  type QuoteRequest,
  type RouterRepresentation,
  type Venue,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardQuote } from "@henar/execution-guard";
import { capabilityOf } from "@henar/router-app";
import { buildTransaction, normalizeSimulation, planExecution, RpcSimulator } from "@henar/tx-builder";
import { RateLimitError, retryAfterMs } from "@/lib/execution/shared";
import { createLimiter } from "./rate-limit";
import { raydiumAdapter, raydiumCpmmAdapter } from "@henar/venue-raydium";
import { orcaAdapter } from "@henar/venue-orca";

type Stage = "QUOTE" | "GUARD" | "SELECT" | "REPRESENTATION" | "PLAN" | "BUILD" | "SIMULATE" | "PASS";
type Outcome = { venue: string; symbol: string; side: "buy" | "sell"; pool: string; stage: Stage; detail: string };

const adapters = [raydiumAdapter, raydiumCpmmAdapter, orcaAdapter];

/**
 * A venue can have several adapters (Raydium CLMM and CPMM share `raydium`);
 * prefer the one whose capabilities cover the registry pool's type.
 */
function adapterForPool(venue: Venue, poolAddress: string) {
  const poolType = poolByAddress(poolAddress)?.poolType;
  return (
    adapters.find((a) => a.venue === venue && poolType !== undefined && a.capabilities().poolTypes.includes(poolType)) ??
    adapters.find((a) => a.venue === venue)
  );
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const treasuryOwner = process.env.STOCKROOM_TREASURY_OWNER;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required; a fixture run would not be validation.");
  if (!treasuryOwner) throw new Error("STOCKROOM_TREASURY_OWNER is required to plan the fee transfer.");
  if (!flagEnabled("routerExecution"))
    throw new Error("HENAR_ROUTER_EXECUTION is off; run this with the flag set for this process only.");

  const assumeMintFacts = process.argv.includes("--assume-mint-facts");
  const perVenue = Number(process.env.BUILD_SIM_PER_VENUE ?? "3");
  const sizeUsd = Number(process.env.BUILD_SIM_SIZE_USD ?? "10");
  /* One paced RPC queue under the client. Without it, web3.js retries a 429
     five times and then throws, and the quotes taken before the backoff have
     aged past the guard's freshness window by the time the build runs: every
     route then fails as QUOTE_EXPIRED, which says nothing about whether it
     could execute. */
  const rpcLimit = createLimiter({
    minIntervalMs: Number(process.env.BUILD_SIM_RPC_INTERVAL_MS ?? "150"),
    retries: 8,
    label: "rpc",
    onBackoff: (waitMs, attempt) => process.stdout.write(`  rpc backoff ${waitMs}ms (attempt ${attempt})\n`),
  });
  const connection = new Connection(rpc, {
    commitment: "confirmed",
    fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      rpcLimit(async () => {
        const response = await fetch(input, init);
        if (response.status === 429)
          throw new RateLimitError("RPC rate limit (429).", retryAfterMs(response.headers.get("retry-after")));
        return response;
      })) as never,
  });
  const registry = loadPoolRegistry();
  const simulator = new RpcSimulator(connection);

  const legBuilder = async (leg: PlannedLeg, options: BuildOptions) => {
    const adapter = adapterForPool(leg.venue, leg.poolAddress);
    if (!adapter) return { instructions: [], lookupTables: [], reason: "VENUE_NOT_CONFIGURED" as const, detail: `no adapter for ${leg.venue}` };
    const rep = routerRepresentationForMint(leg.inputMint) ?? routerRepresentationForMint(leg.outputMint);
    const pools = rep ? poolsForRepresentation(rep.id, { venue: leg.venue }).filter((p) => p.address === leg.poolAddress) : [];
    const now = Date.now();
    const quote = await adapter.getQuote(
      { representationId: rep?.id ?? "", side: rep && leg.outputMint === rep.mint ? "buy" : "sell", amount: leg.amountIn, amountType: "input", inputMint: leg.inputMint, outputMint: leg.outputMint },
      { connection, pools, now, deadlineMs: 20_000 },
    );
    if (quote.unavailableReason) return { instructions: [], lookupTables: [], reason: quote.unavailableReason, detail: quote.unavailableDetail };
    return adapter.buildSwapInstructions(quote, { connection, pools, now, deadlineMs: 20_000 }, options);
  };

  /** Decimals and token program read from the mint itself, never persisted. */
  const mintFacts = async (rep: RouterRepresentation) => {
    const account = await connection.getAccountInfo(new PublicKey(rep.mint), "confirmed");
    if (!account) return null;
    const inspection = inspectionFromAccount(rep.mint, account, new Date().toISOString());
    return inspection.decimals === null || !inspection.program ? null : { decimals: inspection.decimals, tokenProgram: inspection.program };
  };

  /**
   * An owner who holds at least `minimum` of `needMint` in a plain associated
   * token account, so the accounts the planner derives actually exist.
   *
   * Candidates come from the largest holders of the stock mint, never of
   * USDC: `getTokenLargestAccounts` refuses USDC outright (ten million
   * accounts), and a stock holder is also the population most likely to hold
   * USDC. Program-owned vaults are skipped, since their token account is not
   * the ATA the plan will reference.
   */
  const fundedOwner = async (stockMint: string, needMint: string, minimum: bigint) => {
    const largest = await connection.getTokenLargestAccounts(new PublicKey(stockMint), "confirmed");
    for (const candidate of largest.value.slice(0, 15)) {
      const info = await connection.getAccountInfo(candidate.address, "confirmed");
      if (!info) continue;
      let ownerKey: PublicKey;
      try {
        const account = unpackAccount(candidate.address, info, info.owner);
        if (!getAssociatedTokenAddressSync(new PublicKey(stockMint), account.owner, true, info.owner).equals(candidate.address)) continue;
        ownerKey = account.owner;
      } catch {
        continue;
      }
      // The simulated owner pays the fee, so a wallet with no SOL fails as
      // InvalidAccountForFee before the route is ever exercised.
      if ((await connection.getBalance(ownerKey, "confirmed")) < 10_000_000) continue;
      if (needMint === stockMint) {
        if (BigInt(candidate.amount) >= minimum) return ownerKey.toBase58();
        continue;
      }
      // Buy side: the same wallet must also hold the USDC being spent.
      for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const ata = getAssociatedTokenAddressSync(new PublicKey(needMint), ownerKey, true, program);
        const held = await connection.getAccountInfo(ata, "confirmed");
        if (!held) continue;
        try {
          if (unpackAccount(ata, held, held.owner).amount >= minimum) return ownerKey.toBase58();
        } catch {
          // Unreadable; try the other token program, then the next holder.
        }
      }
    }
    return null;
  };

  const targets = ["raydium", "orca"].flatMap((venue) =>
    registry.pools
      .filter((p) => p.enabled && p.venue === venue && p.verification === "ONCHAIN_VERIFIED")
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
      .slice(0, perVenue),
  );

  const outcomes: Outcome[] = [];
  for (const pool of targets) {
    const rep = routerRepresentation(pool.representationId);
    if (!rep) continue;
    const facts = assumeMintFacts ? await mintFacts(rep) : rep.decimals !== null && rep.tokenProgram ? { decimals: rep.decimals, tokenProgram: rep.tokenProgram } : null;
    for (const side of ["buy", "sell"] as const) {
      const record = (stage: Stage, detail: string) => {
        outcomes.push({ venue: pool.venue, symbol: rep.tokenSymbol, side, pool: pool.address, stage, detail });
        process.stdout.write(`${stage === "PASS" ? "PASS" : "STOP"} ${pool.venue.padEnd(8)} ${rep.tokenSymbol.padEnd(9)} ${side.padEnd(4)} ${stage.padEnd(14)} ${detail}\n`);
      };
      if (!facts) {
        record("REPRESENTATION", "decimals/token program not verified for this representation");
        continue;
      }
      // A sell needs a token quantity; a hundredth of a display unit is small
      // enough that a real holder can cover it.
      const amount = side === "buy" ? BigInt(Math.round(sizeUsd * 1_000_000)) : 10n ** BigInt(facts.decimals) / 100n;
      if (amount <= 0n) { record("QUOTE", "derived sell quantity rounded to zero"); continue; }
      const inputMint = side === "buy" ? USDC_MINT : rep.mint;
      const owner = await fundedOwner(rep.mint, inputMint, amount);
      if (!owner) { record("QUOTE", `no ${rep.tokenSymbol} holder also holding ${amount} of ${inputMint} in a plain ATA`); continue; }
      const request: QuoteRequest =
        side === "buy"
          ? { representationId: rep.id, side, amount: amount.toString(), amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint }
          : { representationId: rep.id, side, amount: amount.toString(), amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT };

      /* Only the target pool is quoted, through its own adapter. Quoting the
         representation engine-wide fans out over every enabled pool on both
         venues, and on a paced RPC queue the first quote ages past the
         guard's 15s freshness window before the build runs: every route then
         fails as QUOTE_EXPIRED, which measures the harness, not the route. */
      const adapter = adapterForPool(pool.venue, pool.address)!;
      const feeBps = 15;
      const venueInput = side === "buy" ? amount - (amount * BigInt(feeBps)) / 10_000n : amount;
      const venueRequest: QuoteRequest = { ...request, amount: venueInput.toString() };
      const quote = await adapter.getQuote(venueRequest, { connection, pools: [pool], now: Date.now(), deadlineMs: 30_000 });
      if (quote.unavailableReason) { record("QUOTE", `${quote.unavailableReason}: ${quote.unavailableDetail}`); continue; }
      const ranked = rankQuote(quote, request, feeBps);
      const slot = await connection.getSlot("confirmed");
      const selected = guardQuote(ranked, DEFAULT_EXECUTION_POLICY, { now: Date.now(), currentSlot: slot, reference: null, representationDecimals: facts.decimals });
      if (!selected.approved) { record("GUARD", `${selected.reason}: ${selected.checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.detail}`).join("; ")}`); continue; }
      if (selected.mode !== "execute") { record("SELECT", `approved but ${capabilityOf(selected)} (mode ${selected.mode})`); continue; }

      let plan;
      try {
        plan = planExecution({
          representation: { id: rep.id, provider: rep.provider, mint: rep.mint, decimals: facts.decimals, tokenProgram: facts.tokenProgram },
          side,
          owner,
          treasuryOwner,
          userInput: BigInt(request.amount),
          legs: [{ verdict: selected }],
          policy: DEFAULT_EXECUTION_POLICY,
          now: Date.now(),
        });
      } catch (error) { record("PLAN", (error as Error).message); continue; }

      const built = await buildTransaction(plan, {
        blockhash: {
          async latest() {
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
            return { blockhash, lastValidBlockHeight, source: "rpc" as const };
          },
        },
        legBuilder,
      });
      if (!built.ok) { record("BUILD", `${built.reason}: ${built.detail}`); continue; }

      try {
        const raw = await simulator.simulate(built.built.transaction, plan);
        const simulation = normalizeSimulation(raw, plan);
        if (!simulation.ok) { record("SIMULATE", simulation.error ?? "simulation failed"); continue; }
        record("PASS", `out ${simulation.simulatedOutput} >= floor ${simulation.minimumOutput}, ${simulation.computeUnitsConsumed} CU`);
      } catch (error) { record("SIMULATE", (error as Error).message); }
    }
  }

  const passed = outcomes.filter((o) => o.stage === "PASS").length;
  const byStage = outcomes.reduce((a: Record<string, number>, o) => ({ ...a, [o.stage]: (a[o.stage] ?? 0) + 1 }), {});
  process.stdout.write(`\n${passed}/${outcomes.length} routes built and simulated${assumeMintFacts ? " (mint facts read from chain, not from the catalog)" : ""}\n`);
  process.stdout.write(`stages: ${JSON.stringify(byStage)}\n`);
  if (passed !== outcomes.length) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
