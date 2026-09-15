/**
 * The assets an automatic route may pass through.
 *
 * A user may pick any supported asset as an endpoint. An intermediate is
 * picked for them, so it has to earn the position: a thin middle turns one
 * hop into two spreads and loses money that a direct route would have kept.
 *
 * Membership is measured, not named. `scripts/router/qualify-intermediates.ts`
 * quotes ten thousand dollars into each candidate and straight back out, and
 * what fails to return is the cost of bridging through it at that size, in
 * both directions at once. An asset that cannot be quoted, whose mint is not
 * verified, or whose token semantics we cannot settle never reaches the probe.
 * 40 of 157 discovered counter assets qualified; the rest are recorded with
 * the reason they did not.
 *
 * This module only reads the committed artifact, so routing can never pass
 * through an asset nobody measured.
 */
import artifact from "@/data/router/intermediates.json";

export type IntermediateAsset = {
  mint: string;
  symbol: string | null;
  decimals: number;
  tokenProgram: string;
  roundTripLossBps: number | null;
  qualified: boolean;
  reason: string;
  probedAt: string;
};

export type IntermediateUniverse = {
  generatedAt: string;
  probeNotionalUsd: number;
  maxRoundTripLossBps: number;
  assets: IntermediateAsset[];
};

const universe = artifact as IntermediateUniverse;
const qualified = new Map(universe.assets.filter((a) => a.qualified).map((a) => [a.mint, a]));

/** Every asset that may sit in the middle of an automatic route. */
export function qualifiedIntermediates(): readonly IntermediateAsset[] {
  return [...qualified.values()];
}

export function isQualifiedIntermediate(mint: string) {
  return qualified.has(mint);
}

/** The asset's entry, qualified or not, with the reason it was judged so. */
export function intermediateRecord(mint: string): IntermediateAsset | null {
  return universe.assets.find((a) => a.mint === mint) ?? null;
}

export function intermediateUniverse(): IntermediateUniverse {
  return universe;
}
