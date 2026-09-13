import { equityForMint } from "./registry";

export type RepresentationHolding = {
  mint: string;
  rawAmount: string;
  decimals: number;
};

/** Groups balances without converting base units or treating issuer tokens as fungible. */
export function groupRepresentationHoldings(holdings: RepresentationHolding[]) {
  const groups = new Map<
    string,
    {
      equityId: string;
      ticker: string;
      name: string;
      representations: RepresentationHolding[];
    }
  >();
  for (const holding of holdings) {
    const found = equityForMint(holding.mint);
    if (!found) continue;
    const group = groups.get(found.equity.id) ?? {
      equityId: found.equity.id,
      ticker: found.equity.ticker,
      name: found.equity.name,
      representations: [],
    };
    group.representations.push(holding);
    groups.set(found.equity.id, group);
  }
  return [...groups.values()];
}

/** Converts an approved mint catalog into unique company choices for future packs. */
export function companyCandidatesForMints(mints: string[]) {
  const companies = new Map<
    string,
    { equityId: string; ticker: string; name: string }
  >();
  for (const mint of mints) {
    const found = equityForMint(mint);
    if (found)
      companies.set(found.equity.id, {
        equityId: found.equity.id,
        ticker: found.equity.ticker,
        name: found.equity.name,
      });
  }
  return [...companies.values()];
}
