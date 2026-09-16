/**
 * Tessera adapter — `GET https://rest-api.tessera.pe/v1/public/token-details`.
 *
 * Fields observed in the live response (16 September 2026): id, name,
 * symbol, code, sector, mint, markPrice, holders, markValuation. Only those
 * are normalized. Tessera publishes no token price of its own; the
 * executable reference comes from Henar's routing.
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { provenance, SOURCES } from "@/lib/provenance";
import { ELIGIBILITY, PROVIDER_DOCS, STRUCTURE } from "../structure";
import { companySlug, companyNameFromProduct } from "../companies";
import type { PrivateExposureProduct } from "../types";
import { isSolanaAddress } from "./prestocks";

const finite = z.number().finite().nonnegative();
const rowSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  symbol: z.string().trim().min(1).max(40),
  code: z.string().trim().max(40).nullish(),
  sector: z.string().trim().max(120).nullish(),
  mint: z.string().min(32).max(44),
  markPrice: finite.nullish(),
  holders: z.number().int().nonnegative().nullish(),
  markValuation: finite.nullish(),
});
export type TesseraRow = z.infer<typeof rowSchema>;

export const TESSERA_API = PROVIDER_DOCS.tessera.api;
const CACHE_MS = 5 * 60_000;

export function normalizeTesseraRow(raw: unknown, fetchedAt: string): PrivateExposureProduct | null {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!isSolanaAddress(r.mint)) return null;
  const companyName = companyNameFromProduct("tessera", r.name, r.symbol);
  const base = { ...SOURCES.tessera, observedAt: fetchedAt, url: TESSERA_API };
  const markPresent = r.markPrice !== null && r.markPrice !== undefined;
  const valuationPresent = r.markValuation !== null && r.markValuation !== undefined;
  return {
    id: `tessera:${r.mint}`,
    companyId: `private:${companySlug(companyName)}`,
    provider: "tessera",
    providerProductId: r.id,
    name: r.name,
    symbol: r.symbol,
    mint: r.mint,
    chain: "solana",
    description: null,
    image: null,
    sector: r.sector ?? null,
    mark:
      markPresent || valuationPresent
        ? {
            ...(markPresent ? { price: r.markPrice! } : {}),
            ...(valuationPresent ? { valuation: r.markValuation! } : {}),
            unit: "token",
            provenance: provenance({ ...base, sourceType: "provider-mark" }),
          }
        : null,
    providerToken: null,
    holders: r.holders ?? null,
    structure: { type: STRUCTURE.tessera.type, description: STRUCTURE.tessera.description, sourceUrl: STRUCTURE.tessera.sourceUrl, attribution: STRUCTURE.tessera.attribution },
    eligibility: ELIGIBILITY.tessera,
    externalUrl: PROVIDER_DOCS.tessera.products,
    documentationUrl: PROVIDER_DOCS.tessera.docs,
    onchain: null,
    liquidity: null,
    execution: null,
    updatedAt: fetchedAt,
    provenance: provenance({ ...base, sourceType: "provider-catalog" }),
  };
}

export function normalizeTesseraCatalog(payload: unknown, fetchedAt: string) {
  const rows = z.array(z.unknown()).parse(payload);
  const products: PrivateExposureProduct[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((row, index) => {
    const product = normalizeTesseraRow(row, fetchedAt);
    if (product) products.push(product);
    else rejected.push({ index, reason: rowSchema.safeParse(row).success ? "mint is not a Solana address" : "row does not match the observed schema" });
  });
  return { products, rejected };
}

const cache = createReadCache<{ products: PrivateExposureProduct[]; rejected: { index: number; reason: string }[]; fetchedAt: string }>(CACHE_MS, 2);

export async function tesseraCatalog(options: { fetch?: typeof fetch } = {}) {
  return cache("tessera", async () => {
    const doFetch = options.fetch ?? fetch;
    const response = await doFetch(TESSERA_API, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Tessera API responded ${response.status}`);
    const fetchedAt = new Date().toISOString();
    return { ...normalizeTesseraCatalog(await response.json(), fetchedAt), fetchedAt };
  });
}
