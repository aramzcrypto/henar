import type { Equity } from "@/lib/equities/types";

/**
 * Whether Henar can actually trade a company, and what it would take to.
 *
 * Henar lists 1,339 companies and can trade 94 of them: 2,105 of 2,212
 * verified representations have no enabled pool anywhere in the registry. A
 * unified marketplace where most of the shelf cannot be bought is the
 * product's largest gap, and it is not a listing problem — the mints exist
 * and are verified on chain. It is a liquidity problem, and a bonding curve
 * is the one instrument that bootstraps a market with no liquidity to start
 * from: price discovery happens on the curve, and the pool graduates into
 * ordinary AMM liquidity once it has raised enough to stand on its own.
 *
 * A DBC pool pairing a verified representation with USDC is ROUTER_ELIGIBLE
 * while it bonds, so a market opened this way is quotable by Henar's own
 * router from the moment it exists. That is what makes this part of the
 * marketplace rather than a launchpad beside it.
 */

export type MarketProposal = {
  /** The representation the curve would pair with USDC. */
  tokenSymbol: string;
  provider: string;
  mint: string;
  /** Where the curve starts, in USDC per token. Tracks the share price. */
  openingPrice: number;
  /** USDC the curve must take in before it migrates into DAMM v2. */
  graduationRaise: number;
  /** Where the opening price came from. */
  referenceSource: string;
};


/* A bootstrap is described by the two numbers that decide whether it works:
   where the price starts, and how much the curve must raise before it becomes
   an ordinary pool. Market cap is the wrong frame — sizing by it produced a
   $262m opening valuation for a market meant to bootstrap a few thousand
   dollars of liquidity, which is the kind of number nobody should be asked to
   sanity-check.

   The raise target is what the migrated pool ends up holding, so it is set
   well clear of the $1,000 floor the registry uses to decide a pool is worth
   routing to. Twenty-five thousand leaves a DAMM v2 pool that can absorb a
   real order rather than one that technically exists. */
const GRADUATION_RAISE_USDC = 25_000;

/**
 * The market Henar would open for a company it cannot currently trade.
 *
 * Returns null when there is no verified representation to pair or no price
 * to size a curve from — sizing a curve off a guessed price is how a launch
 * opens at the wrong number and never recovers. Whether the company is
 * already tradable is registry state and is decided by the caller on the
 * server, so this stays pure and never pulls the pool registry into a
 * browser bundle.
 */
export function proposeMarket(
  equity: Equity,
  referencePrice: number | null,
  referenceSource: string,
): MarketProposal | null {
  if (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  const candidate = equity.representations.find(
    (r: Equity["representations"][number]) =>
      r.providerStatus === "verified" && r.tradingStatus !== "unavailable",
  );
  if (!candidate) return null;
  return {
    tokenSymbol: candidate.tokenSymbol,
    provider: candidate.provider,
    mint: candidate.mint,
    openingPrice: referencePrice,
    graduationRaise: GRADUATION_RAISE_USDC,
    referenceSource,
  };
}
