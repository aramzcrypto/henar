/**
 * Company identity across providers.
 *
 * Providers name products by their own conventions ("OpenAI PreStocks",
 * "T-OpenAI"). The company name is recovered by stripping the provider's
 * documented affix, then normalized to a slug. Grouping is presentational:
 * products under one company remain distinct, separately selectable mints.
 */
import type { PrivateCompany, PrivateExposureProduct, PrivateProvider } from "./types";

/** Known spellings that differ between providers, mapped to one canonical name. */
const ALIASES: Record<string, string> = {
  figureai: "Figure AI",
  spacex: "SpaceX",
  openai: "OpenAI",
};

export function companySlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function companyNameFromProduct(provider: PrivateProvider, name: string, symbol: string) {
  let base = name.trim();
  if (provider === "prestocks") base = base.replace(/\s+PreStocks$/i, "").trim() || symbol;
  if (provider === "tessera") base = base.replace(/^T-/i, "").trim() || symbol;
  const key = base.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[key] ?? base;
}

export function groupByCompany(products: PrivateExposureProduct[]): PrivateCompany[] {
  const companies = new Map<string, PrivateCompany>();
  for (const product of products) {
    const slug = product.companyId.replace(/^private:/, "");
    const name = companyNameFromProduct(product.provider, product.name, product.symbol);
    const company = companies.get(slug) ?? { id: product.companyId, name, slug, description: null, sector: null, logo: null, exposureProducts: [], providers: [] };
    company.exposureProducts.push(product);
    if (!company.providers.includes(product.provider)) company.providers.push(product.provider);
    // First paragraph of a provider description reads as the company profile; the second is the product blurb.
    if (!company.description && product.description) company.description = product.description.split(/\n\s*\n/)[0].trim() || null;
    if (!company.sector && product.sector) company.sector = product.sector;
    if (!company.logo && product.image) company.logo = product.image;
    companies.set(slug, company);
  }
  const order: Record<PrivateProvider, number> = { prestocks: 0, tessera: 1 };
  return [...companies.values()]
    .map((c) => ({ ...c, exposureProducts: [...c.exposureProducts].sort((a, b) => order[a.provider] - order[b.provider]), providers: [...c.providers].sort((a, b) => order[a] - order[b]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function companyForSlug(companies: PrivateCompany[], slug: string) {
  return companies.find((c) => c.slug === slug.toLowerCase()) ?? null;
}
