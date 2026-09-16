/**
 * Mark-vs-market analytics. Pure, exact, and refuses to compare figures that
 * do not mean the same thing. A difference is a premium or discount to the
 * provider's mark — never an arbitrage, and never a claim the market must
 * converge to the mark.
 */
import { isPositive, parseDecimal, relativeBps } from "@/lib/pyth/decimal-math";
import type { MarkDeviation, PrivateExposureProduct } from "./types";

const text = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : String(n));

/** (a / b − 1) in bps from two USD figures, or null when either is missing or non-positive. */
export function deviationBps(a: string | number | null | undefined, b: string | number | null | undefined) {
  const ar = parseDecimal(typeof a === "number" ? text(a) : a);
  const br = parseDecimal(typeof b === "number" ? text(b) : b);
  if (!isPositive(ar) || !isPositive(br)) return null;
  return relativeBps(ar, br);
}

/**
 * Compare the onchain token price with the provider mark. The Henar
 * executable reference (a live route, priced per scaled display unit) is
 * preferred; the provider's own token price is the fallback.
 */
export function markDeviation(product: PrivateExposureProduct): MarkDeviation {
  const mark = product.mark;
  const route = product.execution?.status === "available" ? product.execution.referenceUiPrice : null;
  const providerToken = product.providerToken?.price;
  const price = route ?? (providerToken !== undefined ? text(providerToken) : null);
  const priceSource: MarkDeviation["priceSource"] = route ? "henar-route" : providerToken !== undefined ? "provider-token" : null;
  if (!mark || mark.price === undefined) return { productId: product.id, priceDeviationBps: null, valuationDeviationBps: valuationDeviation(product), priceSource, comparable: false, reason: "provider publishes no mark price" };
  if (mark.unit !== "token") return { productId: product.id, priceDeviationBps: null, valuationDeviationBps: valuationDeviation(product), priceSource, comparable: false, reason: "provider mark is not stated per token" };
  if (!price) return { productId: product.id, priceDeviationBps: null, valuationDeviationBps: valuationDeviation(product), priceSource: null, comparable: false, reason: "no token price to compare" };
  const bps = deviationBps(price, mark.price);
  return { productId: product.id, priceDeviationBps: bps, valuationDeviationBps: valuationDeviation(product), priceSource, comparable: bps !== null, reason: bps === null ? "prices are not comparable" : null };
}

export function valuationDeviation(product: PrivateExposureProduct) {
  const implied = product.providerToken?.impliedValuation;
  const mark = product.mark?.valuation;
  if (implied === undefined || mark === undefined) return null;
  return deviationBps(implied, mark);
}

export function formatDeviation(bps: number | null) {
  if (bps === null) return "—";
  return `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
}

export type DislocationRow = {
  productId: string;
  companyId: string;
  companyName: string;
  provider: PrivateExposureProduct["provider"];
  symbol: string;
  markPrice: number | null;
  markValuation: number | null;
  referencePrice: string | null;
  referenceSource: MarkDeviation["priceSource"];
  premiumBps: number | null;
  valuationPremiumBps: number | null;
  liquidityUsd: number | null;
  bestRoute: string | null;
  dataAge: { mark: string | null; reference: string | null };
  comparable: boolean;
  reason: string | null;
};

/** Every product's mark-vs-market read, largest absolute dislocation first; incomparable rows last. */
export function dislocations(products: PrivateExposureProduct[], companyNames: Map<string, string>): DislocationRow[] {
  return products
    .map((product): DislocationRow => {
      const d = markDeviation(product);
      const pools = product.liquidity?.verifiedPools ?? [];
      const liquidityUsd = pools.length ? pools.reduce<number | null>((sum, p) => (p.tvlUsd === null ? sum : (sum ?? 0) + p.tvlUsd), null) : null;
      return {
        productId: product.id,
        companyId: product.companyId,
        companyName: companyNames.get(product.companyId) ?? product.name,
        provider: product.provider,
        symbol: product.symbol,
        markPrice: product.mark?.price ?? null,
        markValuation: product.mark?.valuation ?? null,
        referencePrice: product.execution?.status === "available" ? product.execution.referenceUiPrice : product.providerToken?.price !== undefined ? String(product.providerToken.price) : null,
        referenceSource: d.priceSource,
        premiumBps: d.priceDeviationBps,
        valuationPremiumBps: d.valuationDeviationBps,
        liquidityUsd,
        bestRoute: product.execution?.bestRoute ?? null,
        dataAge: { mark: product.mark?.provenance.observedAt ?? null, reference: product.execution?.quotedAt ?? product.providerToken?.provenance.observedAt ?? null },
        comparable: d.comparable,
        reason: d.reason,
      };
    })
    .sort((a, b) => {
      if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
      return Math.abs(b.premiumBps ?? 0) - Math.abs(a.premiumBps ?? 0);
    });
}
