/**
 * Atomic transaction builder (Task 14) — assembles one v0 transaction from
 * an `ExecutionPlan`:
 *
 *   compute budget (unit limit, priority fee)
 *   idempotent ATA creation for the user's output ATA and the fee ATA
 *   Henar fee transfer (TransferChecked; Token or Token-2022 by plan)
 *     — on input for buys, before the swaps; on output for sells, after
 *   venue instructions per leg, in plan order, each built by its adapter
 *     with the plan's per-leg minimum (Task 15) and re-checked here
 *
 * Blockhash and lookup tables are injected through interfaces; no live
 * value is invented. Gated by HENAR_ROUTER_EXECUTION (default off): with
 * the flag off the builder returns `disabled` and never builds.
 */
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import {
  flagEnabled,
  fromRaw,
  type BuildOptions,
  type BuildResult,
  type ExecutionPlan,
  type PlannedLeg,
  type UnavailableReason,
} from "@henar/router-core";
import { assertPlanFloors } from "./planner";

export interface BlockhashProvider {
  /** Returns a real recent blockhash from RPC (live) or a labelled fixture value (tests). */
  latest(): Promise<{ blockhash: string; lastValidBlockHeight: number; source: "rpc" | "fixture" }>;
}

export interface LookupTableProvider {
  resolve(addresses: string[]): Promise<AddressLookupTableAccount[]>;
}

/** Builds the venue instructions for one leg; adapters implement this via buildSwapInstructions. */
export type LegInstructionBuilder = (leg: PlannedLeg, options: BuildOptions) => Promise<BuildResult>;

export type BuiltTransaction = {
  transaction: VersionedTransaction;
  planId: string;
  blockhash: string;
  lastValidBlockHeight: number;
  blockhashSource: "rpc" | "fixture";
  instructionCount: number;
  accountKeys: number;
  lookupTables: string[];
  /** Every leg's floor as passed to its adapter, for audit. */
  legFloors: { index: number; venue: string; minimumAmountOut: string }[];
  /** Programs each leg's instructions invoke (aggregator legs report theirs). */
  legPrograms: { index: number; programIds: string[] }[];
  builtAt: string;
};

export type BuildOutcome =
  | { ok: true; built: BuiltTransaction }
  | { ok: false; reason: UnavailableReason | "EXECUTION_DISABLED"; detail: string };

export type BuilderOptions = {
  executionEnabled?: boolean;
  blockhash: BlockhashProvider;
  lookupTables?: LookupTableProvider;
  legBuilder: LegInstructionBuilder;
  now?: number;
};

export async function buildTransaction(plan: ExecutionPlan, options: BuilderOptions): Promise<BuildOutcome> {
  const enabled = options.executionEnabled ?? flagEnabled("routerExecution");
  if (!enabled) return { ok: false, reason: "EXECUTION_DISABLED", detail: "HENAR_ROUTER_EXECUTION is off" };
  const now = options.now ?? Date.now();
  if (Date.parse(plan.expiresAt) < now) return { ok: false, reason: "QUOTE_EXPIRED", detail: `plan expired at ${plan.expiresAt}` };
  try {
    assertPlanFloors(plan);
  } catch (error) {
    return { ok: false, reason: "INVALID_REQUEST", detail: (error as Error).message };
  }

  const owner = new PublicKey(plan.owner);
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: plan.compute.unitLimit }),
  ];
  if (plan.compute.priorityFeeMicroLamports > 0)
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: plan.compute.priorityFeeMicroLamports }));

  // ATAs: output and fee destination, idempotent (no-op when they exist).
  for (const a of plan.requiredAtas.filter((x) => x.purpose !== "user-input"))
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(owner, new PublicKey(a.address), new PublicKey(a.owner), new PublicKey(a.mint), new PublicKey(a.tokenProgram)),
    );

  const feeAta = plan.requiredAtas.find((a) => a.purpose === "henar-fee")!;
  const feeSource = plan.requiredAtas.find((a) => (plan.henarFee.on === "input" ? a.purpose === "user-input" : a.purpose === "user-output"))!;
  const feeIx = () =>
    createTransferCheckedInstruction(
      new PublicKey(feeSource.address),
      new PublicKey(plan.henarFee.mint),
      new PublicKey(feeAta.address),
      owner,
      fromRaw(plan.henarFee.amount),
      plan.henarFee.decimals,
      [],
      new PublicKey(plan.henarFee.tokenProgram),
    );
  if (plan.henarFee.on === "input" && fromRaw(plan.henarFee.amount) > 0n) instructions.push(feeIx());

  const legFloors: BuiltTransaction["legFloors"] = [];
  const legPrograms: BuiltTransaction["legPrograms"] = [];
  for (const leg of plan.legs) {
    const result = await options.legBuilder(leg, { owner: plan.owner, minimumAmountOut: leg.minimumAmountOut });
    if (result.reason || !result.instructions.length)
      return { ok: false, reason: result.reason ?? "INVALID_REQUEST", detail: `leg ${leg.index} (${leg.venue}): ${result.detail ?? "no instructions"}` };
    for (const ix of result.instructions)
      for (const k of ix.keys)
        if (k.isSigner && !k.pubkey.equals(owner)) return { ok: false, reason: "INVALID_REQUEST", detail: `leg ${leg.index} requires signer ${k.pubkey.toBase58()}` };
    instructions.push(...result.instructions);
    legFloors.push({ index: leg.index, venue: leg.venue, minimumAmountOut: leg.minimumAmountOut });
    legPrograms.push({ index: leg.index, programIds: result.programIds ?? [...new Set(result.instructions.map((ix) => ix.programId.toBase58()))] });
  }
  if (plan.henarFee.on === "output" && fromRaw(plan.henarFee.amount) > 0n) instructions.push(feeIx());

  const { blockhash, lastValidBlockHeight, source } = await options.blockhash.latest();
  const tables = plan.lookupTables.addresses.length && options.lookupTables ? await options.lookupTables.resolve(plan.lookupTables.addresses) : [];
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message(tables);
  const transaction = new VersionedTransaction(message);
  return {
    ok: true,
    built: {
      transaction,
      planId: plan.planId,
      blockhash,
      lastValidBlockHeight,
      blockhashSource: source,
      instructionCount: instructions.length,
      accountKeys: message.staticAccountKeys.length + message.addressTableLookups.reduce((s, l) => s + l.readonlyIndexes.length + l.writableIndexes.length, 0),
      lookupTables: tables.map((t) => t.key.toBase58()),
      legFloors,
      legPrograms,
      builtAt: new Date(now).toISOString(),
    },
  };
}

/** FIXTURE ONLY: a labelled, non-live blockhash for offline construction tests. */
export const fixtureBlockhashProvider = (label = "FIXTURE"): BlockhashProvider => ({
  async latest() {
    // 32 zero bytes is a syntactically valid, obviously fake blockhash.
    void label;
    return { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0, source: "fixture" };
  },
});
