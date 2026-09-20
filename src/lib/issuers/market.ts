/**
 * What an issuer's tokens actually do on Solana, measured across every mint
 * Henar holds for it rather than across a sample.
 *
 * The figure that matters here is not the total but the ratio behind it.
 * Backpack publishes more than a thousand Solana mints and a few dozen have
 * an on-chain market; xStocks publishes fewer and trades far more of them. A
 * headline volume hides that difference, so every total is reported beside
 * the count of mints it came from.
 *
 * The read itself is the catalog-wide pass in `equities/catalog-market`,
 * shared with ranked market views, so comparing issuers costs no extra call.
 */
import { catalogMarket, tradedVolume, type CatalogMarket, type TokenMarketEntry } from "@/lib/equities/catalog-market";
import { JUPITER_TOKEN_API } from "@/lib/equities/catalog-market";
import { equityForMint } from "@/lib/equities/registry";
import { provenance } from "@/lib/provenance";
import type { Representation } from "@/lib/equities/types";
import { issuerRepresentations } from "./profiles";
import { ISSUER_IDS, type IssuerId, type IssuerMarket, type IssuerMintMarket } from "./types";

const TOP_MINTS = 6;

function sum(values: (number | null)[]) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

function mintRow(representation: Representation, entry: TokenMarketEntry): IssuerMintMarket {
  const company = equityForMint(representation.mint)?.equity ?? null;
  return {
    mint: representation.mint,
    tokenSymbol: representation.tokenSymbol,
    ticker: company?.ticker ?? representation.equityId.replace(/^equity:/, ""),
    name: company?.name ?? representation.tokenSymbol,
    logo: company?.logo ?? representation.logo,
    priceUsd: entry.usdPrice ?? null,
    priceChange24hPct: entry.stats24h?.priceChange ?? null,
    volume24hUsd: tradedVolume(entry),
    liquidityUsd: entry.liquidity ?? null,
    holders: entry.holderCount ?? null,
    marketCapUsd: entry.mcap ?? null,
  };
}

/** Aggregate one issuer's mints from an already-read catalog pass. */
export function aggregateIssuerMarket(id: IssuerId, market: CatalogMarket): IssuerMarket {
  const representations = issuerRepresentations(id);
  const rows = representations.flatMap((representation) => {
    const entry = market.entries.get(representation.mint);
    return entry ? [mintRow(representation, entry)] : [];
  });
  const base = {
    mintsQueried: representations.length,
    provenance: provenance({
      source: "Jupiter",
      provider: "jupiter",
      sourceType: "dex-index" as const,
      observedAt: market.observedAt,
      freshness: "fresh" as const,
      url: JUPITER_TOKEN_API,
    }),
  };
  if (!rows.length)
    return {
      ...base,
      status: "unavailable",
      mintsWithMarket: 0,
      tradedMints: 0,
      pricedMints: 0,
      mintsWithLiquidity: 0,
      volume24hUsd: null,
      liquidityUsd: null,
      marketCapUsd: null,
      holders: null,
      traders24h: null,
      top: [],
      reason: representations.length
        ? "The market source returned nothing for this issuer's mints."
        : "No verified representations for this issuer.",
    };
  const withMarket = rows.filter(
    (row) => row.priceUsd !== null || row.liquidityUsd !== null || row.volume24hUsd !== null || row.holders !== null,
  );
  const traders = representations.flatMap((representation) => {
    const value = market.entries.get(representation.mint)?.stats24h?.numTraders;
    return typeof value === "number" ? [value] : [];
  });
  return {
    ...base,
    status: "available",
    mintsWithMarket: withMarket.length,
    tradedMints: rows.filter((row) => (row.volume24hUsd ?? 0) > 0).length,
    pricedMints: rows.filter((row) => row.priceUsd !== null).length,
    mintsWithLiquidity: rows.filter((row) => (row.liquidityUsd ?? 0) > 0).length,
    volume24hUsd: sum(rows.map((row) => row.volume24hUsd)),
    liquidityUsd: sum(rows.map((row) => row.liquidityUsd)),
    marketCapUsd: sum(rows.map((row) => row.marketCapUsd)),
    holders: sum(rows.map((row) => row.holders)),
    /* Summed per mint, so a wallet active on two of this issuer's tokens is
       counted twice. It is an upper bound on distinct traders, and the
       interface says so rather than calling it a total. */
    traders24h: traders.length ? traders.reduce((total, value) => total + value, 0) : null,
    top: [...rows]
      .sort(
        (a, b) =>
          (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) || (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1),
      )
      .slice(0, TOP_MINTS),
    /* A dropped batch means the totals are short by whatever it held. Saying
       so is the difference between a measurement and a guess. */
    reason: market.complete ? null : "Part of the catalog could not be read; totals cover the mints that answered.",
  };
}

/** Every issuer's on-chain market, from one pass over the whole catalog. */
export async function issuerMarkets(
  options: { fetch?: typeof fetch; fresh?: boolean } = {},
): Promise<Record<IssuerId, IssuerMarket>> {
  const market = await catalogMarket(options);
  return Object.fromEntries(ISSUER_IDS.map((id) => [id, aggregateIssuerMarket(id, market)])) as Record<
    IssuerId,
    IssuerMarket
  >;
}
