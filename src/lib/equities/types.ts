export const PROVIDERS = ["xstocks", "backpack", "ondo"] as const;
export type EquityProvider = (typeof PROVIDERS)[number];
export type EquityAssetType = "stock" | "etf";
export type Availability<T> =
  | { status: "available"; value: T; asOf: string; source: string }
  | { status: "unavailable"; reason?: string };

export type RepresentationCapabilities = {
  tradeCapabilities: {
    dexSwap: boolean;
    rfq: boolean;
    primaryMint: boolean;
    primaryRedeem: boolean;
  };
  earnCapabilities: {
    lending: boolean;
    vault: boolean;
    liquidityPool: boolean;
  };
  marketCapabilities: {
    secondaryTrading: boolean;
    primaryMarket: boolean;
    transfers: boolean;
    afterHoursTrading: boolean;
  };
};

export type RouteType = "DEX" | "RFQ" | "PRIMARY_MINT" | "PRIMARY_REDEEM";
export type EquityRoute = {
  id: string;
  representationId: string;
  provider: EquityProvider;
  tokenSymbol: string;
  mint: string;
  routeType: RouteType;
  venue: string;
  side: "buy" | "sell";
  availability: "available" | "requires_connection" | "unavailable";
  eligibilityRequirements: string[];
  settlementNotes: string | null;
  destinationUrl: string | null;
  sourceUrl: string;
  checkedAt: string;
  quote: {
    inputAmount: string;
    inputUnit: string;
    outputAmount: string;
    outputUnit: string;
    effectivePrice: string;
    fees: {
      providerFeeBps: number | null;
      protocolFeeAmount: string | null;
      networkFeeAmount: string | null;
    };
    priceImpactPct: string | null;
    expiresAt: string;
  } | null;
};

export type EarnOpportunity = {
  id: string;
  companyId: string;
  representationId: string;
  provider: EquityProvider;
  protocol: string;
  opportunityType: "lending" | "vault" | "liquidity_pool";
  network: "solana";
  currentAPY: number | null; // Percent, variable; null is never displayed as zero.
  tvlUsd: number | null;
  utilization: number | null; // Ratio [0, 1].
  underlyingToken: { mint: string; symbol: string };
  destinationUrl: string;
  status: "available" | "requires_verification" | "unavailable";
  lastUpdated: string;
  sourceUrl: string;
};
export type EarnDiscovery = {
  opportunities: EarnOpportunity[];
  sources: {
    protocol: string;
    status: "available" | "unavailable";
    reason: string | null;
  }[];
};

export type Representation = RepresentationCapabilities & {
  id: string;
  equityId: string;
  provider: EquityProvider;
  providerLabel: string;
  issuer: string;
  tokenSymbol: string;
  mint: string;
  tokenProgram: string | null;
  decimals: number | null;
  providerStatus: "verified" | "unavailable";
  tradingStatus: "unknown" | "active" | "unavailable" | "paused";
  issuerUrl: string;
  sourceUrl: string;
  verifiedAt: string;
  redemptionModel: string | null;
  dividendTreatment: string | null;
  transferRestrictions: string | null;
  corporateActionMechanism: string | null;
  defiSupport: string[] | null;
  logo: string | null;
};

export type Equity = {
  id: string;
  name: string;
  ticker: string;
  cik: string | null;
  identifiers: Record<string, string>;
  logo: string | null;
  sector: import("./sectors").Sector | null;
  industry: string | null;
  assetType: EquityAssetType;
  description: string | null;
  representations: Representation[];
};

export type LiveRepresentation = {
  representationId: string;
  provider: EquityProvider;
  tokenSymbol: string;
  mint: string;
  tokenProgram: string | null;
  decimals: number | null;
  executableBuyPrice: number | null;
  executableSellPrice: number | null;
  referencePrice: number | null;
  premiumDiscountPct: number | null;
  spreadPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  marketCapUsd: number | null;
  fullyDilutedUsd: number | null;
  holderCount: number | null;
  /** Percent price change over each window Jupiter publishes. */
  priceWindows: {
    m5: number | null;
    h1: number | null;
    h6: number | null;
    h24: number | null;
  };
  priceImpactPct: Record<"1000" | "10000" | "50000", number | null>;
  jupiterRouteAvailable: boolean | null;
  executionSources: string[];
  liquiditySources: string[];
  poolCount: number;
  quoteAsOf: string | null;
  marketStatus: "active" | "unavailable" | "unknown";
  asOf: string | null;
};

export type EquitySummary = Omit<Equity, "representations"> & {
  representationCount: number;
  providers: EquityProvider[];
  representationSymbols: {
    provider: EquityProvider;
    tokenSymbol: string;
  }[];
  price: number | null;
  priceChange24hPct: number | null;
  onchainVolume24hUsd: number | null;
  liquidityUsd: number | null;
  bestSpreadPct: number | null;
  recentlyTokenizedAt: string | null;
};

export type MarketsOverview = {
  items: EquitySummary[];
  totalVolume24hUsd: number | null;
  sourceTokenCount: number;
  matchedCompanyCount: number;
  asOf: string;
};

export type CorporateActionType =
  | "stock_split"
  | "reverse_split"
  | "dividend"
  | "symbol_change"
  | "issuer_pause";

export type CorporateAction = {
  id: string;
  equityId: string;
  representationIds: string[];
  type: CorporateActionType;
  effectiveAt: string;
  providerHandling: Partial<Record<EquityProvider, string>>;
  multiplier: { numerator: string; denominator: string } | null;
  status: "announced" | "effective" | "cancelled";
  sourceUrl: string;
  verifiedAt: string;
};

export type ResearchSection<T> = {
  status: "available" | "unavailable";
  data: T | null;
  asOf: string | null;
  sourceUrl: string | null;
};

export type CompanyProfile = {
  description: string | null;
  website: string | null;
  headquarters: string | null;
  employees: number | null;
  cik?: string | null;
  industry?: string | null;
};
export type FinancialPeriod = {
  periodEnd: string;
  fiscalYear: number;
  fiscalPeriod: string | null;
  /** "annual" for 10-K/20-F periods, "quarterly" otherwise. */
  frame: "annual" | "quarterly";
  revenue: string | null;
  grossProfit: string | null;
  operatingIncome: string | null;
  netIncome: string | null;
  eps: string | null;
  /** Balance sheet. */
  assets: string | null;
  liabilities: string | null;
  equity: string | null;
  cash: string | null;
  /** Cash flow. */
  operatingCashFlow: string | null;
  investingCashFlow: string | null;
  financingCashFlow: string | null;
  capitalExpenditure: string | null;
  currency: string;
};
export type EarningsEvent = {
  reportedAt: string;
  fiscalPeriod: string;
  actualEps: string | null;
  estimatedEps: string | null;
};
export type DividendRecord = {
  periodEnd: string;
  filedAt: string;
  amount: string;
  currency: string;
};
export type FilingRecord = {
  accessionNumber: string;
  form: string;
  filedAt: string;
  url: string;
};
export type NewsItem = {
  id: string;
  headline: string;
  publishedAt: string;
  publisher: string;
  url: string;
};

export type EquityResearch = {
  profile: ResearchSection<CompanyProfile>;
  financials: ResearchSection<FinancialPeriod[]>;
  earnings: ResearchSection<EarningsEvent[]>;
  dividends: ResearchSection<DividendRecord[]>;
  filings: ResearchSection<FilingRecord[]>;
  news: ResearchSection<NewsItem[]>;
};

export type QuoteAlternative = {
  routeType: RouteType;
  eligibilityRequirements: string[];
  settlementNotes: string | null;
  representationId: string;
  provider: EquityProvider;
  tokenSymbol: string;
  mint: string;
  route: { label: string; percent: number }[];
  effectivePrice: string;
  inputAmount: string;
  expectedReceivedAmount: string;
  minimumReceivedAmount: string | null;
  priceImpactPct: string | null;
  protocolFeeAmount: string;
  networkFeeAmount: null;
  executionSource: string;
  quoteProvider: string;
  providerFeeBps: number;
  quotedAt: string;
  expiresAt: string;
};

export type AggregatedQuote = {
  equity: string;
  side: "buy" | "sell";
  selectedRepresentation: QuoteAlternative;
  alternatives: QuoteAlternative[];
  quotedAt: string;
  expiresAt: string;
  executable: false;
};
