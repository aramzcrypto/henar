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
  orca: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  /** Aggregator legs carry their real program set from the build (`programIds`). */
  titan: "aggregator:titan",
  openocean: null,
  okx: null,
  rfq: null,
};

/** Conservative per-venue compute and account estimates (refined from simulation, Task 16). */
export const VENUE_COMPUTE_ESTIMATE: Record<Venue, { units: number; accounts: number }> = {
  jupiter: { units: 300_000, accounts: 40 },
  titan: { units: 400_000, accounts: 48 },
  openocean: { units: 300_000, accounts: 40 },
  okx: { units: 300_000, accounts: 40 },
  rfq: { units: 300_000, accounts: 40 },
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
  /** Default "parallel". A "path" runs its legs in sequence through `intermediate`. */
  kind?: "parallel" | "path";
  /** Required for a path: the asset between the hops, with facts read from chain. */
  intermediate?: { mint: string; decimals: number; tokenProgram: string } | null;
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

function tokenProgramFor(mint: string, representation: PlanInput["representation"], intermediate?: PlanInput["intermediate"]) {
  if (mint === USDC_MINT) return TOKEN_PROGRAM_ID.toBase58();
  if (mint === representation.mint) return representation.tokenProgram;
  if (intermediate && mint === intermediate.mint) return intermediate.tokenProgram;
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
  const kind = input.kind ?? "parallel";
  const intermediate = kind === "path" ? (input.intermediate ?? null) : null;
  if (kind === "path" && !intermediate) throw new Error("a path plan needs the intermediate's mint facts");
  if (kind === "path" && input.legs.length < 2) throw new Error("a path plan needs at least two legs");
  if (intermediate && (intermediate.mint === USDC_MINT || intermediate.mint === input.representation.mint))
    throw new Error("intermediate must differ from both ends of the pair");
  // The plan pair is always USDC ↔ the representation; a path reaches it in two hops.
  const inputMint = input.side === "buy" ? USDC_MINT : input.representation.mint;
  const outputMint = input.side === "buy" ? input.representation.mint : USDC_MINT;
  if (kind === "parallel" && (first.inputMint !== inputMint || first.outputMint !== outputMint))
    throw new Error("plan pair must be USDC ↔ the selected representation");
  /* Expected pair of each leg by position. Buy path: USDC → I, then I →
     representation (one or more parallel legs). Sell path: representation →
     I (one or more), then I → USDC last. */
  const expectedPair = (index: number): { input: string; output: string } => {
    if (kind === "parallel") return { input: inputMint, output: outputMint };
    const i = intermediate!.mint;
    if (input.side === "buy") return index === 0 ? { input: USDC_MINT, output: i } : { input: i, output: input.representation.mint };
    return index === input.legs.length - 1 ? { input: i, output: USDC_MINT } : { input: input.representation.mint, output: i };
  };
  const isOutputLeg = (index: number) => kind === "parallel" || expectedPair(index).output === outputMint;
  const isInputLeg = (index: number) => kind === "parallel" || expectedPair(index).input === inputMint;
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
    const want = expectedPair(index);
    if (q.inputMint !== want.input || q.outputMint !== want.output) throw new Error(`leg ${index} mints differ from the plan pair`);
    if (q.henarFeeBps !== feeBps) throw new Error(`leg ${index} carries a different Henar fee`);
    if (!q.poolAddress && q.venue !== "jupiter") throw new Error(`leg ${index} has no pool address`);
    // A venue may span several programs (Raydium CLMM vs CPMM), so the leg's
    // program comes from the registry pool record when the pool is known and
    // only falls back to the per-venue default (aggregators, unknown pools).
    const registryPool = q.poolAddress ? poolByAddress(q.poolAddress, input.registry) : null;
    const programId = registryPool?.programId ?? HENAR_PROGRAM_IDS[q.venue];
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
    if (isInputLeg(index)) sumIn += amountIn;
    if (isOutputLeg(index)) {
      sumExpected += expected;
      sumMin += min;
    }
    if (q.slot !== null) sourceSlots[q.venue] = q.slot;
    programs.add(programId);
    legs.push({
      index,
      venue: q.venue,
      poolAddress: q.poolAddress ?? "",
      programId,
      inputMint: want.input,
      outputMint: want.output,
      inputTokenProgram: tokenProgramFor(want.input, input.representation, intermediate),
      outputTokenProgram: tokenProgramFor(want.output, input.representation, intermediate),
      amountIn: toRaw(amountIn),
      expectedAmountOut: toRaw(expected),
      minimumAmountOut: toRaw(min),
      percentBps: 0,
      sourceSlot: q.slot,
      quoteSource: q.source,
    });
  }
  if (sumIn !== venueInput) throw new Error(`leg inputs ${sumIn} do not sum to venue input ${venueInput}`);
  if (kind === "path") {
    /* Chained exact-in swaps: the hop out of the intermediate is sized on the
       floor of the hop into it, never on its expected output. A plan that
       fed the expected output forward would fail on chain whenever the first
       hop returned a unit less than expected. */
    const intoIntermediate = legs.filter((l) => l.outputMint === intermediate!.mint);
    const outOfIntermediate = legs.filter((l) => l.inputMint === intermediate!.mint);
    const floorIn = intoIntermediate.reduce((s, l) => s + fromRaw(l.minimumAmountOut), 0n);
    const fedForward = outOfIntermediate.reduce((s, l) => s + fromRaw(l.amountIn), 0n);
    if (floorIn !== fedForward) throw new Error(`path feeds ${fedForward} of the intermediate forward but the first hop floor is ${floorIn}`);
    if (input.side === "buy" && intoIntermediate.length !== 1) throw new Error("a buy path has exactly one USDC → intermediate leg");
    if (input.side === "sell" && outOfIntermediate.length !== 1) throw new Error("a sell path has exactly one intermediate → USDC leg");
  }
  for (const leg of legs) {
    const base = kind === "parallel" || isInputLeg(leg.index) ? venueInput : legs.filter((l) => l.inputMint === leg.inputMint).reduce((s, l) => s + fromRaw(l.amountIn), 0n);
    leg.percentBps = base > 0n ? Number((fromRaw(leg.amountIn) * 10_000n) / base) : 0;
  }

  const henarOutputFee = feeOn === "output" ? bpsOf(sumMin, feeBps) : 0n;
  const feeMint = feeOn === "input" ? inputMint : outputMint;
  const feeProgram = tokenProgramFor(feeMint, input.representation);
  const feeDecimals = feeMint === USDC_MINT ? 6 : input.representation.decimals;
  const feeAmount = feeOn === "input" ? henarInputFee : bpsOf(sumExpected, feeBps);

  const atas: PlannedAta[] = [
    { mint: inputMint, owner: input.owner, address: ata(inputMint, input.owner, tokenProgramFor(inputMint, input.representation)), tokenProgram: tokenProgramFor(inputMint, input.representation), purpose: "user-input" },
    { mint: outputMint, owner: input.owner, address: ata(outputMint, input.owner, tokenProgramFor(outputMint, input.representation)), tokenProgram: tokenProgramFor(outputMint, input.representation), purpose: "user-output" },
    { mint: feeMint, owner: input.treasuryOwner, address: ata(feeMint, input.treasuryOwner, feeProgram), tokenProgram: feeProgram, purpose: "henar-fee" },
    // The intermediate lands in the user's own account between the hops; the
    // builder creates it idempotently, and whatever the first hop returns
    // above its floor stays there.
    ...(intermediate ? [{ mint: intermediate.mint, owner: input.owner, address: ata(intermediate.mint, input.owner, intermediate.tokenProgram), tokenProgram: intermediate.tokenProgram, purpose: "intermediate" as const }] : []),
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
    kind,
    intermediate,
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

/** The mint the user receives: the representation on a buy, USDC on a sell. */
export function planOutputMint(plan: ExecutionPlan) {
  return plan.requiredAtas.find((a) => a.purpose === "user-output")?.mint ?? (plan.side === "sell" ? USDC_MINT : plan.legs[plan.legs.length - 1].outputMint);
}

/** Task 15: re-check a plan's floors before any instruction is built. */
export function assertPlanFloors(plan: ExecutionPlan) {
  let sum = 0n;
  for (const leg of plan.legs) {
    const min = fromRaw(leg.minimumAmountOut);
    if (min <= 0n) throw new Error(`leg ${leg.index} minimumAmountOut is zero`);
    if (min > fromRaw(leg.expectedAmountOut)) throw new Error(`leg ${leg.index} floor above expected`);
    // On a path only the legs that produce the plan's output count towards the aggregate floor.
    if (plan.kind === "parallel" || leg.outputMint === planOutputMint(plan)) sum += min;
  }
  if (sum !== fromRaw(plan.totals.minimumAmountOut)) throw new Error("aggregate minimumAmountOut is not the sum of leg floors");
  if (plan.side === "sell") {
    const net = sum - bpsOf(sum, plan.henarFee.bps);
    if (net !== fromRaw(plan.totals.minimumNetUserOutput)) throw new Error("minimumNetUserOutput disagrees with floors and fee");
  } else if (plan.totals.minimumNetUserOutput !== plan.totals.minimumAmountOut) throw new Error("buy plan net minimum must equal the floor");
}
