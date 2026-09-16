/**
 * PreStocks adapter — `GET https://prestocks.com/api/prestocks`.
 *
 * Fields observed in the live response (16 September 2026): name, symbol,
 * description, image, external_url, contract_address, markPrice,
 * markValuation, tokenPrice, impliedValuation, supply. Only those are
 * normalized; the catalog is fetched, never hard-coded, and every mint must
 * be a valid Solana address before it is admitted.
 */
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { provenance, SOURCES } from "@/lib/provenance";
import { ELIGIBILITY, PROVIDER_DOCS, STRUCTURE } from "../structure";
import { companySlug, companyNameFromProduct } from "../companies";
import type { PrivateExposureProduct } from "../types";

const finite = z.number().finite().nonnegative();
const rowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  symbol: z.string().trim().min(1).max(40),
  description: z.string().max(4000).nullish(),
  image: z.string().url().nullish(),
  external_url: z.string().url().nullish(),
  contract_address: z.string().min(32).max(44),
  markPrice: finite.nullish(),
  markValuation: finite.nullish(),
  tokenPrice: finite.nullish(),
  impliedValuation: finite.nullish(),
  supply: finite.nullish(),
});
export type PreStocksRow = z.infer<typeof rowSchema>;

export const PRESTOCKS_API = PROVIDER_DOCS.prestocks.api;
const CACHE_MS = 5 * 60_000;

export function isSolanaAddress(value: string) {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/** Pure normalization of one API row. Null when the row is malformed or its mint is not a Solana address. */
export function normalizePreStocksRow(raw: unknown, fetchedAt: string): PrivateExposureProduct | null {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!isSolanaAddress(r.contract_address)) return null;
  const companyName = companyNameFromProduct("prestocks", r.name, r.symbol);
  const base = { ...SOURCES.prestocks, observedAt: fetchedAt, url: PRESTOCKS_API };
  const markPresent = r.markPrice !== null && r.markPrice !== undefined;
  const valuationPresent = r.markValuation !== null && r.markValuation !== undefined;
  const tokenPresent = [r.tokenPrice, r.impliedValuation, r.supply].some((v) => v !== null && v !== undefined);
  return {
    id: `prestocks:${r.contract_address}`,
    companyId: `private:${companySlug(companyName)}`,
    provider: "prestocks",
    providerProductId: r.symbol,
    name: r.name,
    symbol: r.symbol,
    mint: r.contract_address,
    chain: "solana",
    description: r.description ?? null,
    image: r.image ?? null,
    sector: null,
    mark:
      markPresent || valuationPresent
        ? {
            ...(markPresent ? { price: r.markPrice! } : {}),
            ...(valuationPresent ? { valuation: r.markValuation! } : {}),
            unit: "token",
            provenance: provenance({ ...base, sourceType: "provider-mark" }),
          }
        : null,
    providerToken: tokenPresent
      ? {
          ...(r.tokenPrice !== null && r.tokenPrice !== undefined ? { price: r.tokenPrice } : {}),
          ...(r.impliedValuation !== null && r.impliedValuation !== undefined ? { impliedValuation: r.impliedValuation } : {}),
          ...(r.supply !== null && r.supply !== undefined ? { supply: r.supply } : {}),
          provenance: provenance({ ...base, sourceType: "provider-catalog" }),
        }
      : null,
    holders: null,
    structure: { type: STRUCTURE.prestocks.type, description: STRUCTURE.prestocks.description, sourceUrl: STRUCTURE.prestocks.sourceUrl, attribution: STRUCTURE.prestocks.attribution },
    eligibility: ELIGIBILITY.prestocks,
    externalUrl: r.external_url ?? null,
    documentationUrl: PROVIDER_DOCS.prestocks.docs,
    onchain: null,
    liquidity: null,
    execution: null,
    updatedAt: fetchedAt,
    provenance: provenance({ ...base, sourceType: "provider-catalog" }),
  };
}

export function normalizePreStocksCatalog(payload: unknown, fetchedAt: string) {
  const rows = z.array(z.unknown()).parse(payload);
  const products: PrivateExposureProduct[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((row, index) => {
    const product = normalizePreStocksRow(row, fetchedAt);
    if (product) products.push(product);
    else rejected.push({ index, reason: rowSchema.safeParse(row).success ? "mint is not a Solana address" : "row does not match the observed schema" });
  });
  return { products, rejected };
}

const cache = createReadCache<{ products: PrivateExposureProduct[]; rejected: { index: number; reason: string }[]; fetchedAt: string }>(CACHE_MS, 2);

export async function prestocksCatalog(options: { fetch?: typeof fetch } = {}) {
  return cache("prestocks", async () => {
    const doFetch = options.fetch ?? fetch;
    const response = await doFetch(PRESTOCKS_API, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`PreStocks API responded ${response.status}`);
    const fetchedAt = new Date().toISOString();
    return { ...normalizePreStocksCatalog(await response.json(), fetchedAt), fetchedAt };
  });
}
