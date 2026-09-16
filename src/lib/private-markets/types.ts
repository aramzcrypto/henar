import type { DataProvenance } from "@/lib/provenance";

/**
 * Private-market exposure products.
 *
 * A PrivateCompany is an identity (OpenAI). Its exposure products are
 * specific tradable tokens from specific providers, each with its own mint,
 * structure and economics. Products that reference the same company are
 * never substituted for one another.
 */
export const PRIVATE_PROVIDERS = ["prestocks", "tessera"] as const;
export type PrivateProvider = (typeof PRIVATE_PROVIDERS)[number];
export const PRIVATE_PROVIDER_LABELS: Record<PrivateProvider, string> = { prestocks: "PreStocks", tessera: "Tessera" };

export type ProviderMark = {
  /** Provider's mark price, in USD, in the unit the provider publishes it for (see `unit`). */
  price?: number;
  valuation?: number;
  /** What one unit of `price` refers to, as the provider states it. */
  unit: "token" | "unspecified";
  provenance: DataProvenance;
};

export type ProviderTokenData = {
  /** Provider-reported token price, USD per display unit. */
  price?: number;
  impliedValuation?: number;
  /** Provider-reported circulating supply, in display units. */
  supply?: number;
  provenance: DataProvenance;
};

export type OnchainState = {
  status: "verified" | "unavailable";
  mint: string;
  tokenProgram: string | null;
  isToken2022: boolean | null;
  decimals: number | null;
  /** Raw base units. */
  supplyRaw: string | null;
  /** Display units: raw / 10^decimals × scaled-UI multiplier when the mint carries one. */
  supplyUi: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: string[];
  transferFeeBps: number | null;
  transferHookProgram: string | null;
  permanentDelegate: string | null;
  scaledUiMultiplier: string | null;
  paused: boolean | null;
  /** True when the Henar Router can settle this mint (every extension understood, not paused). */
  routerSupported: boolean | null;
  unsupportedReason: string | null;
  /** The metadata URI the mint itself publishes, when it carries one. */
  metadataUri: string | null;
  slot: number | null;
  readAt: string | null;
  error: string | null;
  provenance: DataProvenance;
};

export type DepthQuote = {
  notionalUsd: number;
  side: "buy" | "sell";
  status: "available" | "unavailable";
  /** USDC per display unit (decimals only, no UI multiplier). */
  price: string | null;
  /** USDC per scaled display unit when the mint carries a UI multiplier; equals `price` otherwise. */
  uiPrice: string | null;
  outputRaw: string | null;
  inputRaw: string | null;
  priceImpactPct: string | null;
  source: string | null;
  route: { venue: string; pool: string | null; percent: number | null }[];
  transferFeeBps: number | null;
  quotedAt: string | null;
  reason: string | null;
};

export type ExecutionIntelligence = {
  status: "available" | "unavailable";
  /** The $1,000 buy reference the Markets pages and Portfolio use. */
  referencePrice: string | null;
  referenceUiPrice: string | null;
  bestRoute: string | null;
  venues: string[];
  priceImpactPct: string | null;
  henarFeeBps: number;
  transferFeeBps: number | null;
  quotedAt: string | null;
  reason: string | null;
  provenance: DataProvenance;
};

export type LiquidityIntelligence = {
  status: "available" | "unavailable";
  depth: DepthQuote[];
  verifiedPools: { venue: string; address: string; enabled: boolean; verification: string; tvlUsd: number | null; eligibility: string }[];
  routerRegistered: boolean;
  routerEnabled: boolean;
  quotedAt: string | null;
  provenance: DataProvenance;
};

export type PrivateExposureProduct = {
  id: string;
  companyId: string;
  provider: PrivateProvider;
  providerProductId: string | null;
  name: string;
  symbol: string;
  mint: string;
  chain: "solana";
  description: string | null;
  image: string | null;
  sector: string | null;
  mark: ProviderMark | null;
  providerToken: ProviderTokenData | null;
  holders: number | null;
  structure: { type: string; description: string; sourceUrl: string; attribution: string };
  eligibility: { note: string; sourceUrl: string } | null;
  externalUrl: string | null;
  documentationUrl: string;
  onchain: OnchainState | null;
  liquidity: LiquidityIntelligence | null;
  execution: ExecutionIntelligence | null;
  updatedAt: string;
  provenance: DataProvenance;
};

export type PrivateCompany = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sector: string | null;
  logo: string | null;
  exposureProducts: PrivateExposureProduct[];
  providers: PrivateProvider[];
};

export type ProviderSourceStatus = {
  provider: PrivateProvider;
  status: "available" | "unavailable";
  products: number;
  fetchedAt: string | null;
  error: string | null;
  url: string;
};

export type PrivateMarkets = {
  companies: PrivateCompany[];
  products: PrivateExposureProduct[];
  sources: ProviderSourceStatus[];
  generatedAt: string;
};

/** Mark-vs-market analytics for one product. Null fields mean "not computable", never zero. */
export type MarkDeviation = {
  productId: string;
  /** (token price / provider mark price − 1) in bps; null unless both are per-token figures. */
  priceDeviationBps: number | null;
  /** (implied valuation / mark valuation − 1) in bps. */
  valuationDeviationBps: number | null;
  /** Which token price was compared: the Henar executable reference or the provider's own token price. */
  priceSource: "henar-route" | "provider-token" | null;
  comparable: boolean;
  reason: string | null;
};
