/**
 * Verified Henar ↔ Pyth feed mappings.
 *
 * A mapping is never made on ticker similarity alone. Each one records the
 * independent facts that bind the two sides:
 *
 *  underlying    the catalog's `Equity.US.<TICKER>/USD` feed, asset_type
 *                equity, quoted in USD, exactly one match;
 *  xStocks       the feed's description names the issuer's product line
 *                ("… XSTOCK / US DOLLAR"), the token segment of its symbol
 *                (`Crypto.<TOKEN>/USD`) is exactly the token symbol the
 *                issuer publishes for that mint, and — where Pyth publishes
 *                one — the `Crypto.<TOKEN>/<TICKER>.RR` redemption-rate feed
 *                ties that token to the same underlying ticker Henar groups
 *                the mint under;
 *  Ondo          the description names the issuer's product line ("… ONDO
 *                TOKENIZED STOCK") and the token segment matches the
 *                issuer's token symbol;
 *  Backpack      Pyth publishes no Backpack feeds today; recorded as unmapped.
 *
 * A token symbol such as NVDAx is an issuer product identifier, not a company
 * ticker, and Henar's catalogue records it from the issuer's own product page.
 * Matching it exactly, together with the issuer named in Pyth's description,
 * is what pins the feed to the product — never ticker resemblance.
 */
import type { Equity, Representation } from "@/lib/equities/types";
import { provenance, SOURCES } from "@/lib/provenance";
import type { PythCatalogIndex } from "./catalog";
import type { PythCatalogEntry, PythCompanyFeeds, PythFeedMapping, PythFeedRole } from "./types";

const ISSUER_KEYWORD: Record<string, RegExp> = {
  xstocks: /\bXSTOCK\b/i,
  ondo: /\bONDO TOKENIZED STOCK\b/i,
};

function mapping(entry: PythCatalogEntry, role: PythFeedRole, representation: Representation | null, evidence: string[], fetchedAt: string): PythFeedMapping {
  return {
    role,
    feedId: entry.feedId,
    symbol: entry.symbol,
    hermesId: entry.hermesId,
    assetType: entry.assetType,
    state: entry.state,
    minChannel: entry.minChannel,
    exponent: entry.exponent,
    representationId: representation?.id ?? null,
    provider: representation?.provider ?? null,
    evidence,
    provenance: provenance({ ...SOURCES.pyth, sourceType: "oracle", observedAt: fetchedAt, url: "https://pyth.dourolabs.app/v1/symbols" }),
  };
}

/** The underlying equity feed for a ticker, only when the catalog is unambiguous. */
export function resolveUnderlyingFeed(ticker: string, catalog: PythCatalogIndex): PythFeedMapping | null {
  const symbol = `EQUITY.US.${ticker.toUpperCase()}/USD`;
  const entry = catalog.bySymbol.get(symbol);
  if (!entry) return null;
  if (entry.assetType !== "equity" || (entry.quoteCurrency && entry.quoteCurrency !== "USD")) return null;
  return mapping(entry, "underlying", null, [`catalog symbol ${entry.symbol}`, "asset_type equity", "quote currency USD"], catalog.fetchedAt);
}

/** The token segment of a `Crypto.<TOKEN>/<QUOTE>` symbol, uppercased. */
export function tokenSegment(symbol: string) {
  const m = /^CRYPTO\.([^/]+)\//i.exec(symbol);
  return m ? m[1].toUpperCase() : null;
}

function resolveTokenizedFeed(equity: Equity, representation: Representation, catalog: PythCatalogIndex) {
  const keyword = ISSUER_KEYWORD[representation.provider];
  if (!keyword) return { feed: null, redemption: null, reason: `Pyth publishes no ${representation.providerLabel} feeds` };
  const sym = representation.tokenSymbol.toUpperCase();
  const entry = catalog.bySymbol.get(`CRYPTO.${sym}/USD`);
  if (!entry) return { feed: null, redemption: null, reason: `no Crypto.${sym}/USD feed in the Pyth catalog` };
  if (!keyword.test(entry.description)) return { feed: null, redemption: null, reason: `Crypto.${sym}/USD is not described as a ${representation.providerLabel} product` };
  /* The symbol's token segment, not the catalog's `name` field: `name` is the
     symbol's two segments run together (NVDAXUSD), so comparing it with a
     token symbol would reject every real mapping. */
  if (tokenSegment(entry.symbol) !== sym) return { feed: null, redemption: null, reason: `catalog symbol ${entry.symbol} does not name token ${representation.tokenSymbol}` };
  const evidence = [`catalog symbol ${entry.symbol}`, `description names the issuer: "${entry.description}"`, `symbol names the issuer token ${representation.tokenSymbol}`];
  const rr = catalog.bySymbol.get(`CRYPTO.${sym}/${equity.ticker.toUpperCase()}.RR`);
  let redemption: PythFeedMapping | null = null;
  if (rr) {
    evidence.push(`Pyth redemption-rate feed ${rr.symbol} pairs the token with ${equity.ticker}`);
    redemption = mapping(rr, "redemption-rate", representation, [`catalog symbol ${rr.symbol}`, `asset_type ${rr.assetType}`], catalog.fetchedAt);
  }
  return { feed: mapping(entry, "tokenized", representation, evidence, catalog.fetchedAt), redemption, reason: null };
}

export function resolveCompanyFeeds(equity: Equity, catalog: PythCatalogIndex): PythCompanyFeeds {
  const tokenized: Record<string, PythFeedMapping> = {};
  const redemptionRates: Record<string, PythFeedMapping> = {};
  const unmapped: PythCompanyFeeds["unmapped"] = [];
  for (const representation of equity.representations) {
    const { feed, redemption, reason } = resolveTokenizedFeed(equity, representation, catalog);
    if (feed) tokenized[representation.id] = feed;
    else unmapped.push({ representationId: representation.id, provider: representation.provider, reason: reason ?? "unmapped" });
    if (redemption) redemptionRates[representation.id] = redemption;
  }
  return { ticker: equity.ticker, equityId: equity.id, underlying: resolveUnderlyingFeed(equity.ticker, catalog), tokenized, redemptionRates, unmapped };
}

/** Every feed id a company's mappings reference. */
export function feedIdsOf(feeds: PythCompanyFeeds): number[] {
  const ids = new Set<number>();
  if (feeds.underlying) ids.add(feeds.underlying.feedId);
  for (const m of Object.values(feeds.tokenized)) ids.add(m.feedId);
  for (const m of Object.values(feeds.redemptionRates)) ids.add(m.feedId);
  return [...ids];
}
