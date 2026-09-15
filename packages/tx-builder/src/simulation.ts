/**
 * Pre-send simulation (Task 16).
 *
 * `Simulator` is the seam: `RpcSimulator` calls `simulateTransaction` with
 * token-account tracking (LIVE_VALIDATION_PENDING — never exercised on this
 * device); `normalizeSimulation` is pure and turns any raw response into a
 * `SimulationResult` checked against the plan's expected and minimum output.
 * A simulation whose output lands below the plan floor is a failure even if
 * the program did not error.
 */
import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { fromRaw, toRaw, type ExecutionPlan, type SimulationResult, type TokenDelta } from "@henar/router-core";

/** Minimal raw shape shared by RPC responses and recorded fixtures. */
export type RawSimulation = {
  err: unknown | null;
  logs: string[] | null;
  unitsConsumed: number | null;
  slot: number | null;
  /** Token balances observed before and after, keyed by token account. */
  tokenBalances: { account: string; mint: string; owner: string; before: string; after: string | null }[];
  accountsChanged?: string[];
  live: boolean;
};

export interface Simulator {
  simulate(transaction: VersionedTransaction, plan: ExecutionPlan): Promise<RawSimulation>;
}

function describeError(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function normalizeSimulation(raw: RawSimulation, plan: ExecutionPlan, now = Date.now()): SimulationResult {
  const tokenDeltas: TokenDelta[] = raw.tokenBalances.map((b) => ({
    mint: b.mint,
    owner: b.owner,
    account: b.account,
    before: b.before,
    after: b.after,
    delta: b.after === null ? null : (BigInt(b.after) - BigInt(b.before)).toString(),
  }));
  /* Read the output from the account the plan designates, by address.
     `purpose: "user-output"` names exactly one account; matching on mint and
     owner instead cannot tell it apart from any other account of that mint in
     the plan, and then a shortfall cannot be attributed to the route rather
     than to the accounting. */
  const outputMint = plan.legs[0]?.outputMint ?? null;
  const destination = plan.requiredAtas.find((a) => a.purpose === "user-output") ?? null;
  const userOut = destination
    ? (tokenDeltas.find((d) => d.account === destination.address) ?? null)
    : (tokenDeltas.find((d) => d.mint === outputMint && d.owner === plan.owner) ?? null);
  const simulatedOutput = userOut && userOut.delta !== null ? BigInt(userOut.delta) : null;
  const outputAccount = userOut
    ? { address: userOut.account, mint: userOut.mint, owner: userOut.owner, before: userOut.before, after: userOut.after, delta: userOut.delta }
    : null;
  const expected = fromRaw(plan.totals.expectedAmountOut);
  // On sells the fee is taken from the output account after the swap, so
  // the user's net delta is the floor net of fee; compare accordingly.
  const floor = plan.side === "sell" ? fromRaw(plan.totals.minimumNetUserOutput) : fromRaw(plan.totals.minimumAmountOut);
  const outputWithinPlan = simulatedOutput === null ? null : simulatedOutput >= floor;
  const provenance = destination
    ? `destination ${destination.address}`
    : "no user-output account in the plan; fell back to a mint and owner match";
  /* An unreported post state is not a shortfall. Saying so keeps a missing
     account from being reported as a route that lost the user their balance. */
  const postMissing = userOut !== null && userOut.after === null;
  const error =
    describeError(raw.err) ??
    (postMissing
      ? `simulation did not return the post state of ${provenance}; output unverified`
      : outputWithinPlan === false
        ? `simulated output ${simulatedOutput} below plan floor ${floor} (${provenance})`
        : null);
  return {
    ok: error === null && outputWithinPlan !== false,
    error,
    computeUnitsConsumed: raw.unitsConsumed,
    logs: raw.logs ?? [],
    tokenDeltas,
    outputAccount,
    expectedOutput: toRaw(expected),
    simulatedOutput: simulatedOutput === null ? null : simulatedOutput.toString(),
    minimumOutput: toRaw(floor),
    outputWithinPlan,
    slot: raw.slot,
    accountsChanged: raw.accountsChanged ?? tokenDeltas.filter((d) => d.delta !== null && d.delta !== "0").map((d) => d.account),
    simulatedAt: new Date(now).toISOString(),
    live: raw.live,
  };
}

/**
 * LIVE_VALIDATION_PENDING. Uses `simulateTransaction` with `accounts` set to
 * the plan's ATAs so post-balances can be read from the response.
 */
export class RpcSimulator implements Simulator {
  constructor(private readonly connection: Connection) {}

  async simulate(transaction: VersionedTransaction, plan: ExecutionPlan): Promise<RawSimulation> {
    const { PublicKey } = await import("@solana/web3.js");
    const { unpackAccount } = await import("@solana/spl-token");
    const addresses = plan.requiredAtas.map((a) => a.address);
    const before = await this.connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed");
    const res = await this.connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses },
    });
    const tokenBalances: RawSimulation["tokenBalances"] = [];
    for (let i = 0; i < addresses.length; i += 1) {
      const meta = plan.requiredAtas[i];
      const pre = before[i];
      const post = res.value.accounts?.[i] ?? null;
      const decode = (data: Buffer | null) => {
        if (!data || data.length === 0) return "0";
        try {
          return unpackAccount(new PublicKey(meta.address), { data, owner: new PublicKey(meta.tokenProgram), executable: false, lamports: 0 }, new PublicKey(meta.tokenProgram)).amount.toString();
        } catch {
          return "0";
        }
      };
      tokenBalances.push({
        account: meta.address,
        mint: meta.mint,
        owner: meta.owner,
        before: decode(pre?.data ?? null),
        // A missing post state is unknown, never zero.
        after: post ? decode(Buffer.from(post.data[0], "base64")) : null,
      });
    }
    return {
      err: res.value.err,
      logs: res.value.logs ?? null,
      unitsConsumed: res.value.unitsConsumed ?? null,
      slot: res.context.slot,
      tokenBalances,
      live: true,
    };
  }
}
