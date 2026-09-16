/**
 * The committed private-market router artifact (`src/data/router/private-markets.json`).
 *
 * The Markets pages read provider catalogs live; the router only quotes
 * mints someone reviewed, verified on chain and committed, exactly as it
 * does for public equities. `scripts/router/discover-private-markets.ts`
 * writes this file from the live provider APIs plus RPC reads.
 */
import artifact from "@/data/router/private-markets.json";
import type { PrivateProvider } from "./types";

export type RouterPrivateProduct = {
  provider: PrivateProvider;
  providerProductId: string | null;
  symbol: string;
  name: string;
  mint: string;
  companySlug: string;
  companyName: string;
  sourceUrl: string;
  discoveredAt: string;
};

export type PrivateMarketsArtifact = { generatedAt: string | null; sources: Record<string, string>; products: RouterPrivateProduct[] };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validateArtifact(value: PrivateMarketsArtifact) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of value.products) {
    if (!BASE58.test(p.mint)) problems.push(`${p.symbol}: mint is not base58`);
    if (p.provider !== "prestocks" && p.provider !== "tessera") problems.push(`${p.symbol}: unknown provider ${p.provider}`);
    if (seen.has(p.mint)) problems.push(`${p.symbol}: duplicate mint ${p.mint}`);
    seen.add(p.mint);
    if (!p.companySlug) problems.push(`${p.symbol}: missing companySlug`);
  }
  return problems;
}

let cached: RouterPrivateProduct[] | null = null;

export function routerPrivateProducts(): RouterPrivateProduct[] {
  if (!cached) {
    const value = artifact as PrivateMarketsArtifact;
    const problems = validateArtifact(value);
    if (problems.length) throw new Error(`Invalid private-markets artifact: ${problems.join("; ")}`);
    cached = value.products;
  }
  return cached;
}

export function routerPrivateProductForMint(mint: string) {
  return routerPrivateProducts().find((p) => p.mint === mint) ?? null;
}
