/**
 * The shape of an Earn pool and its type labels — and nothing else.
 *
 * These are imported by client components. They used to live beside
 * `loadStockEarnCatalog`, so importing a four-entry label map dragged the
 * whole equities catalog into the browser: /earn/[pool] shipped 463 kB of
 * first-load JS for a constant and a type. A leaf module with no data imports
 * is what keeps that from happening again — add loaders to `pools.ts`, never
 * here.
 */
export type EarnPool = {
  /** URL segment under /earn. */
  slug: string;
  name: string;
  /** Short line under the name in lists and on the detail header. */
  summary: string;
  protocol: string;
  type: "usdc-strategy" | "lending" | "vault" | "liquidity_pool";
  /** The asset a depositor supplies. */
  depositAsset: string;
  /** Company context, absent for the USDC strategy. */
  ticker: string | null;
  company: string | null;
  companyLogo: string | null;
  representation: string | null;
  provider: string | null;
  apy: number | null;
  tvlUsd: number | null;
  status: "live" | "coming_soon";
  sourceUrl: string | null;
  externalUrl: string | null;
};

export const POOL_TYPE_LABELS: Record<EarnPool["type"], string> = {
  "usdc-strategy": "USDC strategy",
  lending: "Lending",
  vault: "Vault",
  liquidity_pool: "LP",
};
