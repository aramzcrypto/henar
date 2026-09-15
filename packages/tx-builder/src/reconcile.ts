/**
 * Execution reconciliation (Task 18).
 *
 * The result of an execution is what the chain says happened, never what a
 * submission endpoint replied. `reconcileExecution` reads a confirmed
 * transaction (via an injected fetcher — RPC live, fixtures in tests),
 * derives amounts from pre/post token balances for the owner and the fee
 * destination, and produces an `ExecutionResult` with an honest status:
 *
 *   CONFIRMED  transaction found, no error, output ≥ plan floor
 *   FAILED     transaction found with an error, or output below floor
 *   EXPIRED    not found and the blockhash can no longer land
 *   SUBMITTED  not found, blockhash still valid (keep polling)
 *   UNKNOWN    fetcher failed
 *
 * `ExecutionTracker` holds the lifecycle QUOTED → BUILT → SIGNED →
 * SUBMITTED → (CONFIRMED | FAILED | EXPIRED | UNKNOWN) and refuses
 * backwards or skipped transitions.
 */
import { fromRaw, type ExecutionPlan, type ExecutionResult, type ExecutionStatus } from "@henar/router-core";

export type ConfirmedTransaction = {
  signature: string;
  slot: number;
  err: unknown | null;
  feeLamports: number;
  /** Token balances by account, before and after. */
  tokenBalances: { account: string; mint: string; owner: string; before: string; after: string }[];
  logs?: string[];
};

export type TransactionFetcher = (signature: string) => Promise<ConfirmedTransaction | null>;

export async function reconcileExecution(input: {
  plan: ExecutionPlan;
  signature: string;
  lastValidBlockHeight: number;
  currentBlockHeight: number;
  fetch: TransactionFetcher;
  now?: number;
}): Promise<ExecutionResult> {
  const { plan } = input;
  const route = plan.legs.map((l) => ({ venue: l.venue, poolAddress: l.poolAddress }));
  const base = { planId: plan.planId, signature: input.signature, route, reconciledAt: new Date(input.now ?? Date.now()).toISOString() };
  let tx: ConfirmedTransaction | null;
  try {
    tx = await input.fetch(input.signature);
  } catch (error) {
    return { ...base, status: "UNKNOWN", slot: null, amountIn: null, amountOut: null, henarFee: null, networkFeeLamports: null, failureReason: `fetch failed: ${(error as Error).message}`, onchain: false };
  }
  if (!tx) {
    const expired = input.currentBlockHeight > input.lastValidBlockHeight;
    return { ...base, status: expired ? "EXPIRED" : "SUBMITTED", slot: null, amountIn: null, amountOut: null, henarFee: null, networkFeeLamports: null, failureReason: expired ? "blockhash expired without confirmation" : null, onchain: false };
  }
  const inputMint = plan.legs[0].inputMint;
  const outputMint = plan.legs[0].outputMint;
  const delta = (mint: string, owner: string, account?: string) => {
    const rows = tx!.tokenBalances.filter((b) => b.mint === mint && b.owner === owner && (!account || b.account === account));
    if (!rows.length) return null;
    return rows.reduce((s, b) => s + (BigInt(b.after) - BigInt(b.before)), 0n);
  };
  const userIn = delta(inputMint, plan.owner);
  const userOut = delta(outputMint, plan.owner);
  const fee = delta(plan.henarFee.mint, plan.henarFee.destinationOwner, plan.henarFee.destination);
  const amountIn = userIn === null ? null : (-userIn).toString();
  const amountOut = userOut === null ? null : userOut.toString();
  const floor = plan.side === "sell" ? fromRaw(plan.totals.minimumNetUserOutput) : fromRaw(plan.totals.minimumAmountOut);
  let status: ExecutionStatus = "CONFIRMED";
  let failureReason: string | null = null;
  if (tx.err) {
    status = "FAILED";
    failureReason = typeof tx.err === "string" ? tx.err : JSON.stringify(tx.err);
  } else if (userOut !== null && userOut < floor) {
    status = "FAILED";
    failureReason = `confirmed output ${userOut} below plan floor ${floor}`;
  } else if (userOut === null) {
    status = "UNKNOWN";
    failureReason = "output balance change not observable in transaction meta";
  }
  return {
    ...base,
    status,
    slot: tx.slot,
    amountIn,
    amountOut,
    henarFee: fee === null ? null : fee.toString(),
    networkFeeLamports: String(tx.feeLamports),
    failureReason,
    onchain: true,
  };
}

const ORDER: ExecutionStatus[] = ["QUOTED", "BUILT", "SIGNED", "SUBMITTED"];
const TERMINAL = new Set<ExecutionStatus>(["CONFIRMED", "FAILED", "EXPIRED"]);

export class ExecutionTracker {
  private state: ExecutionStatus = "QUOTED";
  readonly history: { status: ExecutionStatus; at: string; detail: string | null }[] = [];

  constructor(readonly planId: string, private readonly now: () => number = Date.now) {
    this.history.push({ status: "QUOTED", at: new Date(now()).toISOString(), detail: null });
  }

  get status() {
    return this.state;
  }

  transition(next: ExecutionStatus, detail: string | null = null) {
    if (TERMINAL.has(this.state)) throw new Error(`execution ${this.planId} is terminal (${this.state})`);
    const fromIndex = ORDER.indexOf(this.state);
    const toIndex = ORDER.indexOf(next);
    const forward = toIndex === fromIndex + 1;
    const terminalFromSubmitted = TERMINAL.has(next) && this.state === "SUBMITTED";
    const unknown = next === "UNKNOWN" && this.state === "SUBMITTED";
    // A pre-submission failure (build/sim refused) is allowed from any non-terminal state.
    const failEarly = next === "FAILED" && fromIndex >= 0;
    // Expiry before submission (quote/blockhash lapsed).
    const expireEarly = next === "EXPIRED" && fromIndex >= 0;
    if (!(forward || terminalFromSubmitted || unknown || failEarly || expireEarly))
      throw new Error(`illegal transition ${this.state} → ${next}`);
    this.state = next;
    this.history.push({ status: next, at: new Date(this.now()).toISOString(), detail });
    return this;
  }
}
