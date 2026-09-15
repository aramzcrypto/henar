/**
 * Jupiter as a benchmark venue.
 *
 * Wraps the existing, production-validated `quoteJupiter` so the router sees
 * Jupiter through the same `VenueAdapter` interface as direct venues. Nothing
 * about Jupiter's role changes: it remains the fallback execution path via
 * /api/market until direct execution is validated, and it is the number every
 * direct quote is measured against.
 *
 * Jupiter route metadata is kept verbatim in `rawRouteMetadata` so the
 * benchmark script can show which pools it touched.
 */
import { quoteJupiter } from "@/lib/execution/adapters/jupiter";
import { QUOTE_TTL_MS, RateLimitError } from "@/lib/execution/shared";
import {
  fromRaw,
  unavailableQuote,
  type BuildResult,
  type QuoteContext,
  type QuoteRequest,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueHealth,
  type VenueQuote,
} from "@henar/router-core";

/** Jupiter needs a slippage to size the threshold; the router applies its own. */
const BENCHMARK_SLIPPAGE_BPS = 50;

function pctToBps(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  // Jupiter reports priceImpactPct as a fraction (0.01 = 1%).
  return Math.round(parsed * 10_000);
}

export class JupiterAdapter implements VenueAdapter {
  readonly venue = "jupiter" as const;

  constructor(
    private readonly quote: typeof quoteJupiter = quoteJupiter,
    private readonly slippageBps = BENCHMARK_SLIPPAGE_BPS,
  ) {}

  capabilities(): VenueCapabilities {
    return {
      venue: "jupiter",
      quote: true,
      // Executable today only through /api/market's own Jupiter build and
      // validateWalletRoute; the router builds nothing for Jupiter yet.
      legacyExecution: true,
      nativeBuild: false,
      poolTypes: [],
      supportsMinOut: true,
      supportsToken2022: true,
    };
  }

  async health(): Promise<VenueHealth> {
    const configured = Boolean(process.env.JUPITER_API_KEY);
    return {
      venue: "jupiter",
      healthy: configured,
      checkedAt: new Date().toISOString(),
      detail: configured ? null : "JUPITER_API_KEY is not set",
    };
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    if (request.amountType !== "input")
      return unavailableQuote("jupiter", request, "NOT_IMPLEMENTED", "exact-out", null, ctx.now);
    if (!process.env.JUPITER_API_KEY)
      return unavailableQuote("jupiter", request, "VENUE_NOT_CONFIGURED", "JUPITER_API_KEY is not set", null, ctx.now);

    let result;
    try {
      result = await this.quote(
        {
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          amount: fromRaw(request.amount),
          slippageBps: this.slippageBps,
        },
        // The router applies its own floor; Jupiter's dynamic slippage on the
        // benchmark quote is informational, not a terms mismatch.
        { allowSlippageAdjustment: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Jupiter pushing back is reported as such: a paced caller can retry it,
      // and a benchmark must never read it as illiquidity.
      const reason = error instanceof RateLimitError
        ? "RATE_LIMIT_RETRY"
        : /terms did not match/i.test(message)
          ? "QUOTE_TERMS_MISMATCH"
          : /abort|timeout/i.test(message)
            ? "VENUE_TIMEOUT"
            : "VENUE_UNHEALTHY";
      return unavailableQuote("jupiter", request, reason, message, null, ctx.now);
    }

    if (
      result.inputMint !== request.inputMint ||
      result.outputMint !== request.outputMint ||
      result.inputAmount !== request.amount
    )
      return unavailableQuote("jupiter", request, "QUOTE_TERMS_MISMATCH", "adapter response drifted from request", null, ctx.now);

    const single = result.route.length === 1 ? result.route[0] : null;
    return {
      venue: "jupiter",
      routeType: "DEX",
      representationId: request.representationId,
      poolAddress: single?.pool ?? null,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amountIn: result.inputAmount,
      expectedAmountOut: result.outputAmount,
      minimumAmountOut: result.minimumOutputAmount,
      effectivePrice: null,
      venueFeeBps: null,
      venueFeeAmount: null,
      estimatedNetworkCostLamports: null,
      priceImpactBps: pctToBps(result.priceImpactPct),
      slot: result.contextSlot,
      quotedAt: new Date(ctx.now).toISOString(),
      expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
      source: "jupiter swap/v2/order via quoteJupiter",
      // Reachable through the existing /api/market path, not through the
      // router's own builder. The engine treats this as the fallback venue.
      executionPath: "legacy-market-api",
      // Jupiter routes over pools the router did not verify; no chain check.
      onchainCheckedAtQuote: false,
      unavailableReason: null,
      unavailableDetail: null,
      rawRouteMetadata: { route: result.route, source: result.source },
    };
  }

  async buildSwapInstructions(): Promise<BuildResult> {
    return {
      instructions: [],
      lookupTables: [],
      reason: "NOT_IMPLEMENTED",
      detail: "Jupiter execution stays on /api/market (swap/v2/build).",
    };
  }
}

export const jupiterAdapter = new JupiterAdapter();
