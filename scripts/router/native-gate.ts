/**
 * The executability gate for Henar Native routes.
 *
 * `selectRoute` picks on price and capability. It does not prove that the
 * instructions build, nor that the swap simulates above the plan's floor, so a
 * benchmark that counts a selected native route as a win is reporting a
 * capability it has not demonstrated. This module runs plan, build and
 * simulate against mainnet and returns the stage that refused, so a route that
 * cannot execute is demoted with a reason rather than counted.
 *
 * Nothing is signed and nothing is submitted: simulation runs with sigVerify
 * off, as the owner of a real balance.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, unpackAccount, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  poolsForRepresentation,
  routerRepresentationForMint,
  type BuildOptions,
  type PlannedLeg,
  type QuoteRequest,
  type RouterRepresentation,
  type VenueAdapter,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, type GuardVerdict } from "@henar/execution-guard";
import { buildTransaction, normalizeSimulation, planExecution, RpcSimulator } from "@henar/tx-builder";

/** Where a native route stopped. PASS means it built and simulated. */
export type GateStage = "PASS" | "REPRESENTATION" | "NO_FUNDED_OWNER" | "PLAN" | "BUILD" | "SIMULATE";
export type GateResult = { stage: GateStage; detail: string; computeUnits?: number | null; simulatedOutput?: string | null };

/** Enough SOL to pay a fee; below this the payer fails as InvalidAccountForFee. */
const MIN_LAMPORTS = 10_000_000;

export function createNativeGate(options: {
  connection: Connection;
  adapters: VenueAdapter[];
  treasuryOwner: string;
  policy?: typeof DEFAULT_EXECUTION_POLICY;
}) {
  const { connection, adapters, treasuryOwner } = options;
  const policy = options.policy ?? DEFAULT_EXECUTION_POLICY;
  const simulator = new RpcSimulator(connection);
  /** One owner discovery per (stock mint, needed mint); balances reused by size. */
  const owners = new Map<string, { owner: string; balance: bigint } | null>();

  const legBuilder = async (leg: PlannedLeg, buildOptions: BuildOptions) => {
    const adapter = adapters.find((a) => a.venue === leg.venue);
    if (!adapter) return { instructions: [], lookupTables: [], reason: "VENUE_NOT_CONFIGURED" as const, detail: `no adapter for ${leg.venue}` };
    const rep = routerRepresentationForMint(leg.inputMint) ?? routerRepresentationForMint(leg.outputMint);
    const pools = rep ? poolsForRepresentation(rep.id, { venue: leg.venue }).filter((p) => p.address === leg.poolAddress) : [];
    const now = Date.now();
    const quote = await adapter.getQuote(
      { representationId: rep?.id ?? "", side: rep && leg.outputMint === rep.mint ? "buy" : "sell", amount: leg.amountIn, amountType: "input", inputMint: leg.inputMint, outputMint: leg.outputMint },
      { connection, pools, now, deadlineMs: 20_000 },
    );
    if (quote.unavailableReason) return { instructions: [], lookupTables: [], reason: quote.unavailableReason, detail: quote.unavailableDetail };
    if (quote.poolAddress !== leg.poolAddress)
      return { instructions: [], lookupTables: [], reason: "QUOTE_TERMS_MISMATCH" as const, detail: "pool changed between quote and build" };
    return adapter.buildSwapInstructions(quote, { connection, pools, now, deadlineMs: 20_000 }, buildOptions);
  };

  /**
   * The largest reachable holder of `needMint` among holders of `stockMint`.
   *
   * Candidates come from the stock mint's largest accounts, never from USDC's:
   * `getTokenLargestAccounts` refuses USDC outright at ten million accounts,
   * and a stock holder is the population most likely to hold USDC too. Only
   * plain associated token accounts qualify, since a program vault is not the
   * account the plan derives, and the owner must hold SOL for the fee.
   */
  async function fundedOwner(stockMint: string, needMint: string) {
    const cacheKey = `${stockMint}|${needMint}`;
    const cached = owners.get(cacheKey);
    if (cached !== undefined) return cached;
    let best: { owner: string; balance: bigint } | null = null;
    try {
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
        if ((await connection.getBalance(ownerKey, "confirmed")) < MIN_LAMPORTS) continue;
        let balance = needMint === stockMint ? BigInt(candidate.amount) : 0n;
        if (needMint !== stockMint)
          for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
            const ata = getAssociatedTokenAddressSync(new PublicKey(needMint), ownerKey, true, program);
            const held = await connection.getAccountInfo(ata, "confirmed");
            if (!held) continue;
            try {
              balance = unpackAccount(ata, held, held.owner).amount;
              break;
            } catch {
              // Unreadable; try the other token program.
            }
          }
        if (balance > (best?.balance ?? 0n)) best = { owner: ownerKey.toBase58(), balance };
      }
    } catch {
      // No holder list for this mint (USDC is refused outright); the caller
      // records it as an unsimulatable route rather than a failing one.
      owners.set(cacheKey, null);
      return null;
    }
    owners.set(cacheKey, best);
    return best;
  }

  return {
    /** Plan, build and simulate one native verdict. */
    async check(verdict: GuardVerdict, request: QuoteRequest, rep: RouterRepresentation): Promise<GateResult> {
      if (rep.decimals === null || !rep.tokenProgram)
        return { stage: "REPRESENTATION", detail: "decimals or token program not verified for this representation" };
      const amount = BigInt(request.amount);
      const holder = await fundedOwner(rep.mint, request.inputMint);
      if (!holder) return { stage: "NO_FUNDED_OWNER", detail: `no reachable holder of ${request.inputMint} among ${rep.tokenSymbol} holders` };
      if (holder.balance < amount)
        return { stage: "NO_FUNDED_OWNER", detail: `best holder has ${holder.balance} of ${request.inputMint}, needs ${amount}` };

      let plan;
      try {
        plan = planExecution({
          representation: { id: rep.id, provider: rep.provider, mint: rep.mint, decimals: rep.decimals, tokenProgram: rep.tokenProgram },
          side: request.side,
          owner: holder.owner,
          treasuryOwner,
          userInput: amount,
          legs: [{ verdict }],
          policy,
          now: Date.now(),
        });
      } catch (error) {
        return { stage: "PLAN", detail: (error as Error).message };
      }

      const built = await buildTransaction(plan, {
        blockhash: {
          async latest() {
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
            return { blockhash, lastValidBlockHeight, source: "rpc" as const };
          },
        },
        legBuilder,
      });
      if (!built.ok) return { stage: "BUILD", detail: `${built.reason}: ${built.detail}` };

      try {
        const simulation = normalizeSimulation(await simulator.simulate(built.built.transaction, plan), plan);
        if (!simulation.ok) return { stage: "SIMULATE", detail: simulation.error ?? "simulation failed", computeUnits: simulation.computeUnitsConsumed };
        return {
          stage: "PASS",
          detail: `out ${simulation.simulatedOutput} >= floor ${simulation.minimumOutput}`,
          computeUnits: simulation.computeUnitsConsumed,
          simulatedOutput: simulation.simulatedOutput,
        };
      } catch (error) {
        return { stage: "SIMULATE", detail: (error as Error).message };
      }
    },
  };
}
