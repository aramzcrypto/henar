/**
 * Manifest market discovery and order-book census.
 *
 * Manifest is an open-source central limit order book, not an AMM, and the
 * route-leg census measured it carrying 9.1% of the equity-leg flow Henar
 * cannot quote — the second largest uncovered venue after ZeroFi. An earlier
 * reconnaissance dismissed it as thin on the basis of how many token accounts
 * held an equity mint; that counted the wrong thing.
 *
 * Every market is read from chain through the official SDK. A market is kept
 * when its pair is exactly {verified representation, USDC}, and depth is
 * measured by walking the ask side for a real buy rather than by any nominal
 * balance: an order book with one stale offer is not liquidity.
 *
 * Depth alone is not enough on an order book. Many of these markets carry a
 * single stale offer at a price with no relation to the asset — AMCon offered
 * at 27,100 a share against a real price near 39, which "fills" $50,000 by
 * handing over 1.8 shares. So every market with depth is priced against
 * Jupiter's executable route for the same mint, and one whose implied price is
 * far off is recorded as not competitive. A book that cannot win a route is
 * not liquidity, whatever its notional depth.
 *
 * Requires SOLANA_RPC_URL. Without it nothing is written.
 */
import { writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { inspectMint } from "@henar/router-core";
import { equityRegistry } from "../../src/lib/equities/registry";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUTPUT = "src/data/router/manifest-discovery.json";
const SIZES = [100, 1_000, 5_000, 10_000, 25_000, 50_000];

const JUP = "https://lite-api.jup.ag/swap/v1";
/** Beyond this much worse than Jupiter's route, the book cannot ever win. */
const MAX_DEVIATION_BPS = 2_000;
/** Levels priced above this multiple of the reference are not crossable. */
const PRICE_CEILING_MULTIPLE = 1.5;

type SizeFill = { sizeUsd: number; baseOut: number | null; avgPrice: number | null; filled: boolean };
type ManifestMarket = {
  address: string;
  mint: string;
  representationId: string;
  provider: string;
  tokenSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  bestAsk: number | null;
  bestBid: number | null;
  askLevels: number;
  bidLevels: number;
  /** Largest size in SIZES the ask side can fill completely. */
  depthUsd: number;
  quotes: SizeFill[];
  /** Jupiter's executable price for the same mint, quote per base. */
  referencePrice: number | null;
  /** Manifest's $1,000 execution price against that reference, in bps. */
  vsReferenceBps: number | null;
  /** False when the book is priced too far from the market to ever win. */
  competitive: boolean;
};

/** One price level: the SDK's resting order reduced to what a taker needs. */
type Level = { price: number; qty: number };

/**
 * Walk the ask side spending `usd`; null when the book cannot fill it at a
 * price worth paying.
 *
 * `ceiling` is what makes this a depth measure rather than an arithmetic one.
 * AMZNon holds a couple of shares near 379 and then a wall at tens of
 * thousands: without a ceiling the walk "fills" $50,000 by buying 1.29 shares
 * at an average of $38,606, and the market is recorded as deep. Levels priced
 * above the ceiling are not liquidity a taker would ever cross, so the fill
 * stops there and reports what it could not do.
 */
function fillFromAsks(asks: Level[], usd: number, ceiling: number | null): { baseOut: number; avgPrice: number } | null {
  let remaining = usd;
  let base = 0;
  /* Ascending by price. A partial fill is not an output for the amount asked
     and is reported as no fill, exactly as the AMM adapters treat a partial
     swap: presenting it would overstate the book. */
  for (const { price, qty } of asks) {
    if (price <= 0 || qty <= 0) continue;
    if (ceiling !== null && price > ceiling) break;
    const cost = price * qty;
    if (cost >= remaining) {
      base += remaining / price;
      return { baseOut: base, avgPrice: usd / (base || 1) };
    }
    remaining -= cost;
    base += qty;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const referenceCache = new Map<string, number | null>();

/**
 * Jupiter's executable price for one whole token, quote per base.
 *
 * Decimals come from the mint on chain, never from the Manifest market: a
 * market's own baseDecimals disagreed with the mint for several pairs and a
 * two-decimal difference moves the price by a hundred, which is exactly the
 * size of the "opportunity" that produced 9,999 bps rows on the first pass.
 */
async function referencePrice(connection: Connection, mint: string): Promise<number | null> {
  if (referenceCache.has(mint)) return referenceCache.get(mint)!;
  const inspected = await inspectMint(connection, mint).catch(() => null);
  if (!inspected) { referenceCache.set(mint, null); return null; }
  const baseDecimals = inspected.decimals;
  let price: number | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${JUP}/quote?inputMint=${USDC}&outputMint=${mint}&amount=1000000000&slippageBps=50`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (res?.status === 429) { await sleep(2_000 * (attempt + 1)); continue; }
    if (res?.ok) {
      const body = (await res.json()) as { outAmount?: string };
      const out = body.outAmount ? Number(body.outAmount) / 10 ** baseDecimals : 0;
      if (out > 0) price = 1_000 / out; // 1,000 USDC spent, quote per base
    }
    break;
  }
  await sleep(1_100);
  referenceCache.set(mint, price);
  return price;
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required for Manifest discovery.");
  const { Market } = await import("@cks-systems/manifest-sdk");
  const connection = new Connection(rpc, "confirmed");

  const verified = new Map<string, { representationId: string; provider: string; tokenSymbol: string }>();
  for (const equity of equityRegistry)
    for (const r of equity.representations)
      if (r.providerStatus === "verified")
        verified.set(r.mint, { representationId: r.id, provider: r.provider, tokenSymbol: r.tokenSymbol });

  process.stdout.write(`Probing ${verified.size} verified representations for Manifest markets…\n`);
  const kept: ManifestMarket[] = [];
  let probed = 0;

  for (const [mint, rep] of verified) {
    probed += 1;
    let markets: Awaited<ReturnType<typeof Market.findByMints>>;
    try {
      markets = await Market.findByMints(connection as never, new PublicKey(mint) as never, new PublicKey(USDC) as never);
    } catch (error) {
      process.stdout.write(`  ${rep.tokenSymbol.padEnd(9)} lookup failed: ${(error as Error).message}\n`);
      continue;
    }
    if (!markets.length) continue;

    for (const market of markets) {
      /* asksL2/bidsL2 return resting orders; tokenPrice is quote per base and
         numBaseTokens is the size left on the order. */
      const toLevels = (orders: { tokenPrice: number; numBaseTokens: unknown }[]): Level[] =>
        orders.map((o) => ({ price: o.tokenPrice, qty: Number(o.numBaseTokens) })).filter((l) => l.price > 0 && l.qty > 0);
      const asks = toLevels(market.asksL2() as unknown as { tokenPrice: number; numBaseTokens: unknown }[]);
      const bids = toLevels(market.bidsL2() as unknown as { tokenPrice: number; numBaseTokens: unknown }[]);
      /* The reference is fetched before depth is measured, because depth is
         only meaningful relative to a price a taker would accept. A transient
         RPC failure must not lose the whole census: 1,163 markets take twenty
         minutes to walk, and an earlier run died on one bad fetch after
         finishing almost all of them and wrote nothing. */
      const reference = await referencePrice(connection, mint).catch(() => null);
      const ceiling = reference && reference > 0 ? reference * PRICE_CEILING_MULTIPLE : null;
      const row: ManifestMarket = {
        address: market.address.toBase58(),
        mint,
        representationId: rep.representationId,
        provider: rep.provider,
        tokenSymbol: rep.tokenSymbol,
        baseDecimals: market.baseDecimals(),
        quoteDecimals: market.quoteDecimals(),
        bestAsk: market.bestAskPrice() ?? null,
        bestBid: market.bestBidPrice() ?? null,
        askLevels: asks.length,
        bidLevels: bids.length,
        depthUsd: 0,
        quotes: [],
        referencePrice: null,
        vsReferenceBps: null,
        competitive: false,
      };
      for (const sizeUsd of SIZES) {
        const fill = fillFromAsks(asks, sizeUsd, ceiling);
        row.quotes.push({ sizeUsd, baseOut: fill?.baseOut ?? null, avgPrice: fill?.avgPrice ?? null, filled: Boolean(fill) });
        if (fill) row.depthUsd = sizeUsd;
      }
      /* Only markets that fill anything are worth a reference lookup; the
         rest are already excluded on depth. */
      if (row.depthUsd > 0) {
        row.referencePrice = reference;
        const probe = row.quotes.find((q) => q.filled && q.sizeUsd === 1_000) ?? row.quotes.find((q) => q.filled);
        /* A reference that cannot be produced, or a book with no fill, leaves
           the market unclassified rather than assumed competitive. */
        if (reference && reference > 0 && probe?.avgPrice) {
          row.vsReferenceBps = Math.round(((reference - probe.avgPrice) / reference) * 10_000);
          /* Two-sided. Negative means Manifest costs more per share than
             Jupiter. Implausibly *positive* is not an opportunity either: a
             book a hundred times cheaper than the market means the reference
             route is itself thin, and neither number can be trusted. Both
             tails are excluded rather than one. */
          row.competitive = Math.abs(row.vsReferenceBps) <= MAX_DEVIATION_BPS;
        }
      }
      kept.push(row);
      process.stdout.write(
        `  ${rep.tokenSymbol.padEnd(9)} ${row.address.slice(0, 8)} ${String(row.askLevels).padStart(3)} asks, best ${(row.bestAsk ?? 0).toFixed(2).padStart(10)}, fills ${row.depthUsd ? `$${row.depthUsd.toLocaleString("en-US")}`.padStart(8) : "  nothing"}${row.depthUsd ? `  vs ref ${row.vsReferenceBps ?? "?"} bps ${row.competitive ? "" : "NOT COMPETITIVE"}` : ""}\n`,
      );
    }
  }

  kept.sort((a, b) => b.depthUsd - a.depthUsd || a.tokenSymbol.localeCompare(b.tokenSymbol));
  await writeFile(OUTPUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), sizes: SIZES, probed, markets: kept }, null, 2)}\n`, "utf8");
  const withDepth = kept.filter((m) => m.depthUsd >= 1_000);
  const usable = withDepth.filter((m) => m.competitive);
  process.stdout.write(`\nWrote ${OUTPUT}: ${kept.length} equity/USDC markets\n`);
  process.stdout.write(`  ${withDepth.length} fill $1,000 or more on paper\n`);
  process.stdout.write(`  ${usable.length} of those are priced within ${MAX_DEVIATION_BPS} bps of Jupiter either way\n`);
  process.stdout.write(`  ${withDepth.length - usable.length} are stale or junk books that fill only in arithmetic\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
