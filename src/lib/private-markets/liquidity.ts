/**
 * Liquidity intelligence for one product through Henar's existing quote
 * aggregation and pool registry. Quotes are cached per product and notional,
 * requested on demand, and never on render.
 */
import {
  USDC_MINT,
  loadPoolRegistry,
  poolsForPair,
  privateMarketsRoutingEnabled,
  quoteRepresentation,
  routerRepresentationForMint,
  toRaw,
  type QuoteRequest,
} from "@henar/router-core";
import { meteoraAdapter } from "@henar/venue-meteora";
import { raydiumAdapter, raydiumCpmmAdapter } from "@henar/venue-raydium";
import { orcaAdapter } from "@henar/venue-orca";
import { aggregateIndicativeQuotes } from "@/lib/execution/aggregate";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { createReadCache } from "@/lib/read-cache";
import { provenance, SOURCES } from "@/lib/provenance";
import { MARKET_FEE_BPS, tradeFee } from "@/lib/trade-fee";
import { formatUnits, parseUnits } from "@/lib/amount";
import { executablePriceFrom } from "@/lib/pyth/fair-value";
import type { DepthQuote, ExecutionIntelligence, LiquidityIntelligence, OnchainState } from "./types";

export const DEPTH_NOTIONALS = [100, 1_000, 5_000, 10_000] as const;
const REFERENCE_NOTIONAL = 1_000;
const DEPTH_CACHE_MS = 60_000;
const REFERENCE_CACHE_MS = 60_000;

function uiPriceFor(price: string | null, multiplier: string | null) {
  if (!price || !multiplier || multiplier === "1") return price;
  const m = Number(multiplier);
  if (!Number.isFinite(m) || m <= 0) return price;
  // Price per scaled display unit = price per raw display unit / multiplier.
  return (Number(price) / m).toFixed(8).replace(/\.?0+$/, "");
}

/**
 * Henar's own engine, quoting the product's verified pools from chain.
 *
 * This is the same engine, registry and fee accounting the Trade path uses;
 * the HTTP aggregator below is the fallback for when it has nothing. Returns
 * null when private-market routing is off, no RPC is configured, or the
 * engine produced no quote — never a price from somewhere else.
 */
export async function routerEngineQuote(mint: string, side: "buy" | "sell", amount: bigint) {
  if (!privateMarketsRoutingEnabled() || !process.env.SOLANA_RPC_URL) return null;
  const rep = routerRepresentationForMint(mint);
  if (!rep || rep.status !== "ACTIVE") return null;
  const request: QuoteRequest = {
    representationId: rep.id,
    side,
    amount: toRaw(amount),
    amountType: "input",
    inputMint: side === "buy" ? USDC_MINT : mint,
    outputMint: side === "buy" ? mint : USDC_MINT,
  };
  try {
    const result = await quoteRepresentation(request, {
      adapters: [meteoraAdapter, raydiumAdapter, raydiumCpmmAdapter, orcaAdapter],
      connection: rateLimitedConnection(process.env.SOLANA_RPC_URL),
    });
    const best = result.best;
    if (!best) return null;
    return {
      inputAmount: best.fees.userInput,
      outputAmount: best.netOutput,
      grossOutputAmount: best.fees.grossVenueOutput,
      minimumOutputAmount: best.minimumAmountOut ?? best.netOutput,
      priceImpactPct: best.priceImpactBps === null ? null : String(best.priceImpactBps / 10_000),
      source: "henar-router",
      quoteProvider: "henar-router",
      venue: best.venue,
      route: [{ venue: best.venue, pool: best.poolAddress, percent: 100 }],
      quotedAt: best.quotedAt,
      expiresAt: best.expiresAt,
    };
  } catch {
    return null;
  }
}

async function quoteDepth(mint: string, decimals: number, multiplier: string | null, transferFeeBps: number | null, notionalUsd: number, side: "buy" | "sell", referencePrice: string | null): Promise<DepthQuote> {
  const base: DepthQuote = { notionalUsd, side, status: "unavailable", price: null, uiPrice: null, outputRaw: null, inputRaw: null, priceImpactPct: null, source: null, route: [], transferFeeBps, quotedAt: null, reason: null };
  try {
    let amount: bigint;
    if (side === "buy") {
      const gross = parseUnits(String(notionalUsd), 6);
      amount = gross - tradeFee(gross);
    } else {
      if (!referencePrice) return { ...base, reason: "no buy reference to size a sell" };
      const tokens = Number(notionalUsd) / Number(referencePrice);
      if (!Number.isFinite(tokens) || tokens <= 0) return { ...base, reason: "cannot size a sell" };
      amount = parseUnits(tokens.toFixed(Math.min(decimals, 9)), decimals);
    }
    if (amount <= 0n) return { ...base, reason: "amount rounds to zero" };
    /* Henar's engine first, the HTTP aggregators second. Both are quoted
       against the same exact mint; whichever answers, the price shown is one
       Henar could act on. */
    const engine = await routerEngineQuote(mint, side, amount);
    const q = engine ?? (await aggregateIndicativeQuotes({ inputMint: side === "buy" ? USDC_MINT : mint, outputMint: side === "buy" ? mint : USDC_MINT, amount, slippageBps: 50 }).then((a) => a.selected).catch(() => null));
    if (!q) return { ...base, reason: "no verified route" };
    const usdc = formatUnits(BigInt(side === "buy" ? q.inputAmount : q.outputAmount), 6);
    const tokens = formatUnits(BigInt(side === "buy" ? q.outputAmount : q.inputAmount), decimals);
    const price = executablePriceFrom(usdc, tokens);
    return { ...base, status: "available", price, uiPrice: uiPriceFor(price, multiplier), outputRaw: q.outputAmount, inputRaw: q.inputAmount, priceImpactPct: q.priceImpactPct, source: q.source, route: q.route, quotedAt: q.quotedAt, reason: null };
  } catch (error) {
    return { ...base, reason: (error as Error).message };
  }
}

const referenceCache = createReadCache<ExecutionIntelligence>(REFERENCE_CACHE_MS, 64);

/** The $1,000 buy that Markets, the selector and Portfolio use as the executable reference. */
export async function executionReference(mint: string, onchain: OnchainState | null): Promise<ExecutionIntelligence> {
  return referenceCache(mint, async () => {
    const prov = provenance({ ...SOURCES.router, sourceType: "router-quote" });
    const unavailable = (reason: string): ExecutionIntelligence => ({ status: "unavailable", referencePrice: null, referenceUiPrice: null, bestRoute: null, venues: [], priceImpactPct: null, henarFeeBps: MARKET_FEE_BPS, transferFeeBps: onchain?.transferFeeBps ?? null, quotedAt: null, reason, provenance: prov });
    if (!onchain || onchain.status !== "verified" || onchain.decimals === null) return unavailable("mint not verified on chain");
    if (onchain.routerSupported === false) return unavailable(`token extension unsupported: ${onchain.unsupportedReason}`);
    const q = await quoteDepth(mint, onchain.decimals, onchain.scaledUiMultiplier, onchain.transferFeeBps, REFERENCE_NOTIONAL, "buy", null);
    if (q.status !== "available") return unavailable(q.reason ?? "no verified route");
    const venues = [...new Set(q.route.map((r) => r.venue).filter(Boolean))];
    return { status: "available", referencePrice: q.price, referenceUiPrice: q.uiPrice, bestRoute: venues.length ? `${venues.join(" + ")} via ${q.source}` : q.source, venues, priceImpactPct: q.priceImpactPct, henarFeeBps: MARKET_FEE_BPS, transferFeeBps: onchain.transferFeeBps, quotedAt: q.quotedAt, reason: null, provenance: prov };
  });
}

/** The registry's view of a mint's pools. Local file read: no network, no quotes. */
export function registryLiquidity(mint: string): LiquidityIntelligence {
  const registry = loadPoolRegistry();
  const pools = poolsForPair(mint, USDC_MINT, { includeDisabled: true, registry }).concat(registry.pools.filter((p) => p.mint === mint && p.baseMint !== USDC_MINT && p.quoteMint !== USDC_MINT));
  return {
    status: "unavailable",
    depth: [],
    verifiedPools: pools.map((p) => ({ venue: p.venue, address: p.address, enabled: p.enabled, verification: p.verification, tvlUsd: p.tvlUsd, eligibility: p.eligibility })),
    routerRegistered: pools.length > 0,
    routerEnabled: pools.some((p) => p.enabled),
    quotedAt: null,
    provenance: provenance({ ...SOURCES.router, sourceType: "router-quote" }),
  };
}

const depthCache = createReadCache<LiquidityIntelligence>(DEPTH_CACHE_MS, 32);

/** Depth ladder plus the registry's view of the product's pools. */
export async function liquidityIntelligence(mint: string, onchain: OnchainState | null): Promise<LiquidityIntelligence> {
  return depthCache(mint, async () => {
    const prov = provenance({ ...SOURCES.router, sourceType: "router-quote" });
    const base = registryLiquidity(mint);
    if (!onchain || onchain.status !== "verified" || onchain.decimals === null) return base;
    const decimals = onchain.decimals;
    const buys = await Promise.all(DEPTH_NOTIONALS.map((n) => quoteDepth(mint, decimals, onchain.scaledUiMultiplier, onchain.transferFeeBps, n, "buy", null)));
    const reference = buys.find((b) => b.notionalUsd === REFERENCE_NOTIONAL && b.status === "available")?.price ?? buys.find((b) => b.status === "available")?.price ?? null;
    const sell = await quoteDepth(mint, decimals, onchain.scaledUiMultiplier, onchain.transferFeeBps, REFERENCE_NOTIONAL, "sell", reference);
    const depth = [...buys, sell];
    return { ...base, status: depth.some((d) => d.status === "available") ? "available" : "unavailable", depth, quotedAt: new Date().toISOString(), provenance: prov };
  });
}
