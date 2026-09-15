/**
 * Transaction planner (Task 13) with on-chain minOut propagation (Task 15).
 *
 * Turns guard-approved quotes — one venue, or the legs of a split — into a
 * venue-independent `ExecutionPlan`. No serialization happens here.
 *
 * Invariants enforced (throwing, never defaulting):
 *  - every leg has a positive `minimumAmountOut` ≤ its expected output;
 *  - the aggregate floor is the exact sum of leg floors;
 *  - leg inputs sum exactly to the venue input (user input minus fee on buys);
 *  - the plan's fee, side and mints agree with the guard verdicts;
 *  - all legs share the same input/output pair (USDC ↔ one representation).
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "node:crypto";
import {
  bpsOf,
  fromRaw,
  poolByAddress,
  toRaw,
  USDC_MINT,
  type ExecutionPlan,
  type ExecutionPolicy,
  type PlannedAta,
  type PlannedLeg,
  type PoolRegistry,
  type Provider,
  type RankedQuote,
  type Side,
  type Venue,
} from "@henar/router-core";
import type { GuardVerdict } from "@henar/execution-guard";

export const HENAR_PROGRAM_IDS: Record<Venue, string | null> = {
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  raydium: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  meteora: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "meteora-dbc": "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  "meteora-damm-v2": "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  orca: null,
};

/** Conservative per-venue compute and account estimates (refined from simulation, Task 16). */
export const VENUE_COMPUTE_ESTIMATE: Record<Venue, { units: number; accounts: number }> = {
  jupiter: { units: 300_000, accounts: 40 },
  raydium: { units: 200_000, accounts: 24 },
  meteora: { units: 250_000, accounts: 26 },
  "meteora-dbc": { units: 180_000, accounts: 18 },
  "meteora-damm-v2": { units: 180_000, accounts: 18 },
  orca: { units: 200_000, accounts: 24 },
};

const BASE_ACCOUNTS = 12; // owner, ATAs, token programs, compute budget, system
const ACCOUNT_LIMIT_WITHOUT_LUT = 48;

export type PlanLegInput = {
  verdict: GuardVerdict;
  /** For split legs: this leg's input. Defaults to the verdict's full venue input. */
  amountIn?: bigint;
  expectedAmountOut?: bigint;
  minimumAmountOut?: bigint;
};

export type PlanInput = {
  representation: { id: string; provider: Provider; mint: string; decimals: number; tokenProgram: string };
  side: Side;
  owner: string;
  treasuryOwner: string;
  /** User input amount (before the Henar fee on buys). */
  userInput: bigint;
  legs: PlanLegInput[];
  policy: ExecutionPolicy;
  priorityFeeMicroLamports?: number;
  registry?: PoolRegistry;
  now?: number;
  lookupTableAddresses?: string[];
};

function tokenProgramFor(mint: string, representation: PlanInput["representation"]) {
  if (mint === USDC_MINT) return TOKEN_PROGRAM_ID.toBase58();
  if (mint === representation.mint) return representation.tokenProgram;
  throw new Error(`mint ${mint} is outside the plan's pair`);
}

function ata(mint: string, owner: string, tokenProgram: string) {
  return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(tokenProgram)).toBase58();
}

export function planExecution(input: PlanInput): ExecutionPlan {
  const now = input.now ?? Date.now();
  if (!input.legs.length) throw new Error("plan needs at least one leg");
  if (input.userInput <= 0n) throw new Error("user input must be positive");
  const first = input.legs[0].verdict.quote;
  const inputMint = first.inputMint;
  const outputMint = first.outputMint;
  const pair = new Set([inputMint, outputMint]);
  if (!(pair.has(USDC_MINT) && pair.has(input.representation.mint) && pair.size === 2))
    throw new Error("plan pair must be USDC ↔ the selected representation");
  const feeBps = first.henarFeeBps;
  const feeOn = input.side === "buy" ? "input" : "output";
  const henarInputFee = feeOn === "input" ? bpsOf(input.userInput, feeBps) : 0n;
  const venueInput = input.userInput - henarInputFee;

  let sumIn = 0n;
  let sumExpected = 0n;
  let sumMin = 0n;
  const legs: PlannedLeg[] = [];
  const sourceSlots: Partial<Record<Venue, number>> = {};
  const programs = new Set<string>();
  for (const [index, leg] of input.legs.entries()) {
    const v = leg.verdict;
    const q: RankedQuote = v.quote;
    if (!v.approved) throw new Error(`leg ${index} (${q.venue}) is not guard-approved: ${v.reason}`);
    if (q.inputMint !== inputMint || q.outputMint !== outputMint) throw new Error(`leg ${index} mints differ from the plan pair`);
    if (q.henarFeeBps !== feeBps) throw new Error(`leg ${index} carries a different Henar fee`);
    if (!q.poolAddress && q.venue !== "jupiter") throw new Error(`leg ${index} has no pool address`);
    const programId = HENAR_PROGRAM_IDS[q.venue];
    if (!programId) throw new Error(`no program id for venue ${q.venue}`);
    const amountIn = leg.amountIn ?? fromRaw(q.fees.venueInput);
    const expected = leg.expectedAmountOut ?? fromRaw(q.fees.grossVenueOutput);
    const min = leg.minimumAmountOut ?? (v.minimumAmountOut === null ? null : fromRaw(v.minimumAmountOut));
    // Task 15: a leg without a floor is a bug, not a default.
    if (min === null || min <= 0n) throw new Error(`leg ${index} (${q.venue}) has no positive minimumAmountOut`);
    if (min > expected) throw new Error(`leg ${index} minimumAmountOut ${min} exceeds expected ${expected}`);
    if (amountIn <= 0n) throw new Error(`leg ${index} amountIn must be positive`);
    if (input.registry && q.poolAddress) {
      const pool = poolByAddress(q.poolAddress, input.registry);
      if (!pool || pool.venue !== q.venue) throw new Error(`leg ${index} pool ${q.poolAddress} is not a registered ${q.venue} pool`);
    }
    sumIn += amountIn;
    sumExpected += expected;
    sumMin += min;
    if (q.slot !== null) sourceSlots[q.venue] = q.slot;
    programs.add(programId);
    legs.push({
      index,
      venue: q.venue,
      poolAddress: q.poolAddress ?? "",
      programId,
      inputMint,
      outputMint,
      inputTokenProgram: tokenProgramFor(inputMint, input.representation),
      outputTokenProgram: tokenProgramFor(outputMint, input.representation),
      amountIn: toRaw(amountIn),
      expectedAmountOut: toRaw(expected),
      minimumAmountOut: toRaw(min),
      percentBps: 0,
      sourceSlot: q.slot,
      quoteSource: q.source,
    });
  }
  if (sumIn !== venueInput) throw new Error(`leg inputs ${sumIn} do not sum to venue input ${venueInput}`);
  for (const leg of legs) leg.percentBps = Number((fromRaw(leg.amountIn) * 10_000n) / venueInput);

  const henarOutputFee = feeOn === "output" ? bpsOf(sumMin, feeBps) : 0n;
  const feeMint = feeOn === "input" ? inputMint : outputMint;
  const feeProgram = tokenProgramFor(feeMint, input.representation);
  const feeDecimals = feeMint === USDC_MINT ? 6 : input.representation.decimals;
  const feeAmount = feeOn === "input" ? henarInputFee : bpsOf(sumExpected, feeBps);

  const atas: PlannedAta[] = [
    { mint: inputMint, owner: input.owner, address: ata(inputMint, input.owner, tokenProgramFor(inputMint, input.representation)), tokenProgram: tokenProgramFor(inputMint, input.representation), purpose: "user-input" },
    { mint: outputMint, owner: input.owner, address: ata(outputMint, input.owner, tokenProgramFor(outputMint, input.representation)), tokenProgram: tokenProgramFor(outputMint, input.representation), purpose: "user-output" },
    { mint: feeMint, owner: input.treasuryOwner, address: ata(feeMint, input.treasuryOwner, feeProgram), tokenProgram: feeProgram, purpose: "henar-fee" },
  ];
  programs.add(TOKEN_PROGRAM_ID.toBase58());
  if (atas.some((a) => a.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58())) programs.add(TOKEN_2022_PROGRAM_ID.toBase58());
  programs.add("ComputeBudget111111111111111111111111111111");
  programs.add("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  const estimatedUnits = legs.reduce((s, l) => s + VENUE_COMPUTE_ESTIMATE[l.venue].units, 0) + 30_000;
  const accountCount = BASE_ACCOUNTS + legs.reduce((s, l) => s + VENUE_COMPUTE_ESTIMATE[l.venue].accounts, 0);
  const expiresAt = input.legs.map((l) => Date.parse(l.verdict.quote.expiresAt)).reduce((a, b) => Math.min(a, b));
  const slippageBps = Math.min(...input.legs.map((l) => l.verdict.slippageBps ?? input.policy.maxSlippageBps));

  const plan: ExecutionPlan = {
    planId: "",
    representationId: input.representation.id,
    provider: input.representation.provider,
    side: input.side,
    owner: input.owner,
    legs,
    totals: {
      amountIn: toRaw(input.userInput),
      expectedAmountOut: toRaw(sumExpected),
      minimumAmountOut: toRaw(sumMin),
      minimumNetUserOutput: toRaw(sumMin - henarOutputFee),
    },
    henarFee: {
      mint: feeMint,
      amount: toRaw(feeAmount),
      bps: feeBps,
      on: feeOn,
      destination: atas[2].address,
      destinationOwner: input.treasuryOwner,
      tokenProgram: feeProgram,
      decimals: feeDecimals,
    },
    requiredAtas: atas,
    requiredPrograms: [...programs],
    compute: { unitLimit: Math.min(1_400_000, Math.ceil(estimatedUnits * 1.2)), priorityFeeMicroLamports: input.priorityFeeMicroLamports ?? 0, estimatedUnits },
    accountCount,
    lookupTables: { required: accountCount > ACCOUNT_LIMIT_WITHOUT_LUT, addresses: input.lookupTableAddresses ?? [] },
    slippageBps,
    policy: input.policy,
    quotedAt: first.quotedAt,
    expiresAt: new Date(expiresAt).toISOString(),
    sourceSlots,
    createdAt: new Date(now).toISOString(),
  };
  plan.planId = createHash("sha256").update(JSON.stringify({ ...plan, createdAt: undefined })).digest("hex").slice(0, 32);
  return plan;
}

/** Task 15: re-check a plan's floors before any instruction is built. */
export function assertPlanFloors(plan: ExecutionPlan) {
  let sum = 0n;
  for (const leg of plan.legs) {
    const min = fromRaw(leg.minimumAmountOut);
    if (min <= 0n) throw new Error(`leg ${leg.index} minimumAmountOut is zero`);
    if (min > fromRaw(leg.expectedAmountOut)) throw new Error(`leg ${leg.index} floor above expected`);
    sum += min;
  }
  if (sum !== fromRaw(plan.totals.minimumAmountOut)) throw new Error("aggregate minimumAmountOut is not the sum of leg floors");
  if (plan.side === "sell") {
    const net = sum - bpsOf(sum, plan.henarFee.bps);
    if (net !== fromRaw(plan.totals.minimumNetUserOutput)) throw new Error("minimumNetUserOutput disagrees with floors and fee");
  } else if (plan.totals.minimumNetUserOutput !== plan.totals.minimumAmountOut) throw new Error("buy plan net minimum must equal the floor");
}
