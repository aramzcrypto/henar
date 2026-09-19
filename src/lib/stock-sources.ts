import sources from "@/data/stock-sources.json";

/**
 * The issuer page each tokenized stock was taken from, keyed by mint.
 *
 * This lives beside the catalog rather than inside it. `stocks.json` is
 * imported by client components, so every field in it is downloaded by anyone
 * who opens /trade, /portfolio or /packs — and this one is provenance that no
 * page renders: 136 KB of catalog travelling to browsers that never read it.
 * Splitting it keeps the provenance for the manifest and the catalog integrity
 * test without shipping it.
 *
 * Server and build-time only. Importing this from a client component puts the
 * bytes straight back into the bundle.
 */
const byMint: Record<string, string> = sources;

export function sourceForMint(mint: string): string | null {
  return byMint[mint] ?? null;
}

export function stockSourceCount() {
  return Object.keys(byMint).length;
}
