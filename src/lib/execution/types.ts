export type ExecutionSource =
  | "jupiter"
  | "raydium"
  | "orca"
  | "meteora"
  | "phoenix"
  | "openbook"
  | "lifinity"
  | "openocean"
  | "titan";

export type QuoteProvider = "jupiter" | "raydium" | "openocean" | "titan";

export type ExecutionQuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
};

export type ExecutionRouteStep = {
  venue: string;
  pool: string | null;
  percent: number | null;
};

export type NormalizedExecutionQuote = {
  source: ExecutionSource;
  quoteProvider: QuoteProvider;
  quoteId: string | null;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  grossOutputAmount: string;
  outputAmount: string;
  minimumOutputAmount: string;
  providerFeeBps: number;
  providerFeeAmount: string;
  priceImpactPct: string | null;
  route: ExecutionRouteStep[];
  contextSlot: number | null;
  quotedAt: string;
  expiresAt: string;
  transactionAvailable: boolean;
};

export type ExecutionSourceResult =
  | {
      source: ExecutionSource;
      status: "available";
      quote: NormalizedExecutionQuote;
    }
  | {
      source: ExecutionSource;
      status: "unavailable";
      reason: string;
    };

export type AggregatedExecutionQuote = {
  selected: NormalizedExecutionQuote | null;
  candidates: NormalizedExecutionQuote[];
  sources: ExecutionSourceResult[];
  quotedAt: string;
  expiresAt: string | null;
};

export type PoolLiquiditySnapshot = {
  source: "raydium" | "orca" | "meteora";
  pool: string;
  inputMint: string;
  outputMint: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  feePct: number | null;
  price: number | null;
  asOf: string;
};
