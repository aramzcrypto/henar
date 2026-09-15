/**
 * OpenOcean (via QuickNode) as a benchmark venue. Wraps the existing
 * `quoteOpenOcean`; comparison only (`executionPath: "none"`), the engine
 * routes to Henar's own venues or Jupiter for execution. Its 15 bps provider
 * fee is already netted by the shared adapter.
 */
import { quoteOpenOcean } from "@/lib/execution/adapters/openocean";
import { QUOTE_TTL_MS } from "@/lib/execution/shared";
import { fromRaw, unavailableQuote, type BuildResult, type QuoteContext, type QuoteRequest, type VenueAdapter, type VenueCapabilities, type VenueHealth, type VenueQuote } from "@henar/router-core";

export class OpenOceanAdapter implements VenueAdapter {
  readonly venue = "openocean" as const;
  constructor(private readonly quote: typeof quoteOpenOcean = quoteOpenOcean) {}

  capabilities(): VenueCapabilities {
    return { venue: this.venue, quote: true, legacyExecution: false, nativeBuild: false, poolTypes: [], supportsMinOut: true, supportsToken2022: true };
  }
  async health(): Promise<VenueHealth> {
    const configured = Boolean(process.env.OPENOCEAN_API_URL);
    return { venue: this.venue, healthy: configured, checkedAt: new Date().toISOString(), detail: configured ? null : "OPENOCEAN_API_URL is not set" };
  }
  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    if (request.amountType !== "input") return unavailableQuote(this.venue, request, "NOT_IMPLEMENTED", "exact-out", null, ctx.now);
    if (!process.env.OPENOCEAN_API_URL) return unavailableQuote(this.venue, request, "VENUE_NOT_CONFIGURED", "OPENOCEAN_API_URL is not set", null, ctx.now);
    let r;
    try {
      r = await this.quote({ inputMint: request.inputMint, outputMint: request.outputMint, amount: fromRaw(request.amount), slippageBps: 50 });
    } catch (error) {
      const message = (error as Error).message;
      return unavailableQuote(this.venue, request, /timeout|abort/i.test(message) ? "VENUE_TIMEOUT" : "VENUE_UNHEALTHY", message, null, ctx.now);
    }
    if (r.inputMint !== request.inputMint || r.outputMint !== request.outputMint || r.inputAmount !== request.amount)
      return unavailableQuote(this.venue, request, "QUOTE_TERMS_MISMATCH", "adapter response drifted from request", null, ctx.now);
    // OpenOcean reports impact as a percent string (e.g. "0.12%", may be negative).
    const pct = r.priceImpactPct === null ? NaN : Number(String(r.priceImpactPct).replace("%", "").trim());
    const impact = Number.isFinite(pct) ? Math.round(Math.abs(pct) * 100) : null;
    return {
      venue: this.venue,
      routeType: "DEX",
      representationId: request.representationId,
      poolAddress: null,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amountIn: r.inputAmount,
      // Net of OpenOcean's own provider fee.
      expectedAmountOut: r.outputAmount,
      minimumAmountOut: r.minimumOutputAmount,
      effectivePrice: null,
      venueFeeBps: r.providerFeeBps,
      venueFeeAmount: r.providerFeeAmount,
      estimatedNetworkCostLamports: null,
      priceImpactBps: impact !== null && Number.isFinite(impact) ? impact : null,
      slot: r.contextSlot,
      quotedAt: new Date(ctx.now).toISOString(),
      expiresAt: new Date(ctx.now + QUOTE_TTL_MS).toISOString(),
      source: `openocean via quoteOpenOcean (${r.source})`,
      executionPath: "none",
      onchainCheckedAtQuote: false,
      unavailableReason: null,
      unavailableDetail: null,
      rawRouteMetadata: { route: r.route },
    };
  }
  async buildSwapInstructions(): Promise<BuildResult> {
    return { instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: "OpenOcean is a benchmark venue" };
  }
}
export const openOceanAdapter = new OpenOceanAdapter();
