/**
 * Verified mint facts: the execution-critical half of a representation.
 *
 * `src/data/stocks.json` is a product catalogue. It carries no decimals and no
 * token program, and it is the wrong place to learn them: a wrong decimal is a
 * wrong order of magnitude on every amount, and a wrong token program builds
 * instructions against the wrong SPL program. The planner refuses without
 * both, which is why every Native route failed to build while the pool
 * registry was fully verified.
 *
 * This module reads the committed artifact written by the mint verification
 * pass (`apps/router/src/verify-mints-cli.ts`) from one RPC read per mint.
 * It never fetches, never infers and never defaults: a mint absent from the
 * artifact stays unverified, and the planner keeps refusing it.
 */
import mints from "@/data/router/mints.json";
import type { MintInspection } from "./types";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** One mint's facts, as read from chain at a named slot. */
export type VerifiedMint = Pick<
  MintInspection,
  | "mint"
  | "decimals"
  | "isToken2022"
  | "extensions"
  | "transferFeeBps"
  | "transferHookProgram"
  | "scaledUiMultiplier"
  | "permanentDelegate"
  | "nonTransferable"
  | "supported"
  | "unsupportedReason"
> & {
  /** SPL Token or Token-2022, from the mint account's owner. */
  tokenProgram: string;
  /** Chain position the facts were read at. */
  slot: number;
  verifiedAt: string;
};

export function validateVerifiedMint(mint: VerifiedMint) {
  const problems: string[] = [];
  if (!BASE58.test(mint.mint)) problems.push("mint is not base58");
  if (!BASE58.test(mint.tokenProgram)) problems.push("tokenProgram is not base58");
  // A decimal place is an order of magnitude; it is never guessed or defaulted.
  if (!Number.isInteger(mint.decimals) || mint.decimals < 0 || mint.decimals > 18)
    problems.push(`decimals ${mint.decimals} is not an integer in 0..18`);
  if (!Number.isInteger(mint.slot) || mint.slot <= 0) problems.push("slot is not a positive integer");
  if (!mint.verifiedAt || Number.isNaN(Date.parse(mint.verifiedAt))) problems.push("verifiedAt is not a timestamp");
  if (!Array.isArray(mint.extensions)) problems.push("extensions is not an array");
  if (mint.supported && mint.unsupportedReason) problems.push("supported mint carries an unsupportedReason");
  if (!mint.supported && !mint.unsupportedReason) problems.push("unsupported mint has no reason");
  return problems;
}

export function buildVerifiedMints(entries: VerifiedMint[]) {
  const byMint = new Map<string, VerifiedMint>();
  for (const entry of entries) {
    const problems = validateVerifiedMint(entry);
    if (problems.length) throw new Error(`Invalid verified mint ${entry.mint}: ${problems.join("; ")}`);
    if (byMint.has(entry.mint)) throw new Error(`Duplicate verified mint ${entry.mint}`);
    byMint.set(entry.mint, entry);
  }
  return byMint;
}

let cached: Map<string, VerifiedMint> | null = null;

export function loadVerifiedMints() {
  if (!cached) cached = buildVerifiedMints(mints as VerifiedMint[]);
  return cached;
}

export function verifiedMint(mint: string) {
  return loadVerifiedMints().get(mint) ?? null;
}

/** An inspection turned into an artifact row. Chain facts only. */
export function verifiedMintFromInspection(inspection: MintInspection, slot: number, verifiedAt: string): VerifiedMint {
  return {
    mint: inspection.mint,
    tokenProgram: inspection.program,
    decimals: inspection.decimals,
    isToken2022: inspection.isToken2022,
    extensions: [...inspection.extensions].sort(),
    transferFeeBps: inspection.transferFeeBps,
    transferHookProgram: inspection.transferHookProgram,
    scaledUiMultiplier: inspection.scaledUiMultiplier,
    permanentDelegate: inspection.permanentDelegate,
    nonTransferable: inspection.nonTransferable,
    supported: inspection.supported,
    unsupportedReason: inspection.unsupportedReason,
    slot,
    verifiedAt,
  };
}
