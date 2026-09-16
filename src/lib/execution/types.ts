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

/**
 * Providers whose winning quote Henar can actually fill.
 *
 * Two of the four are benchmarks. `/api/market` builds every market swap
 * through Jupiter's build endpoint, and the Henar Router builds Raydium
 * natively, so a quote from either can be honoured. OpenOcean and Titan have
 * no builder anywhere in Henar: their venue adapters return NOT_IMPLEMENTED,
 * and OpenOcean's says in as many words that it is a benchmark venue.
 *
 * Ranking purely by output therefore let a source with no builder take the
 * ticket's "Receive" line and promise an amount the order would never
 * produce. Measured on 16 September 2026, OpenOcean or Titan took the
 * headline in 4 of 23 equity quotes, once by 11.6 bps.
 *
 * Benchmark sources stay in `candidates` and are still shown: telling the
 * user another venue is 12 bps better is worth doing. It just is not a
 * promise.
 */
export const FILLABLE_PROVIDERS = new Set<QuoteProvider>(["jupiter", "raydium"]);

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
  /** Whether Henar can build and submit this route. See FILLABLE_PROVIDERS. */
  fillable: boolean;
};

/**
 * What a quote adapter returns.
 *
 * Fillability is Henar's property, not the provider's — a provider has no
 * idea whether Henar has a builder for it — so adapters do not set it and
 * cannot get it wrong. `available()` derives it on the way in.
 */
export type SourceExecutionQuote = Omit<NormalizedExecutionQuote, "fillable">;

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
