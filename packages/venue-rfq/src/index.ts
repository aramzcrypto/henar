/**
 * RFQ (request-for-quote) as a venue.
 *
 * A firm quote is not an AMM quote: a maker signs a price for one amount, for
 * a short window, and settles through its own program. The router does not
 * build these transactions; it ranks the firm quote against every other
 * source and, when it wins, hands the maker's own transaction to the client
 * to validate and sign.
 *
 * Sources. No open-API RFQ network serves Solana tokenized equities today:
 * Pyth Express Relay was wound down (governance OP-PIP-124), Titan's API is
 * paid, and JupiterZ is reachable only inside Jupiter's own order flow, which
 * is already ranked as the `jupiter` venue. This adapter is therefore a
 * transport-agnostic client over a simple firm-quote protocol, configured by
 * `HENAR_RFQ_URL` (and `HENAR_RFQ_API_KEY` when the maker requires one), so a
 * maker that exposes that protocol can be ranked without another release.
 * With no URL configured it reports VENUE_NOT_CONFIGURED and quotes nothing.
 *
 * Protocol (JSON over HTTPS):
 *   POST {url}/quote
 *     { inputMint, outputMint, amount (raw, exact in), taker?: wallet }
 *   → { maker, inputMint, outputMint, amountIn, amountOut, expiresAt (ISO),
 *       nonce, signature, settlementType, transaction?: base64 }
 * Every field is checked: the pair and amount must match the request, the
 * quote must not already be expired, and nonce and signature must be present.
 * Anything else is refused as QUOTE_TERMS_MISMATCH rather than trusted.
 */
import {
  fromRaw,
  unavailableQuote,
  type BuildResult,
  type QuoteContext,
  type QuoteRequest,
  type RFQQuote,
  type RFQVenueAdapter,
  type VenueAdapter,
  type VenueCapabilities,
  type VenueHealth,
  type VenueQuote,
} from "@henar/router-core";

export type RfqWire = {
  maker?: string;
  inputMint?: string;
  outputMint?: string;
  amountIn?: string;
  amountOut?: string;
  expiresAt?: string;
  nonce?: string;
  signature?: string;
  settlementType?: string;
  /** The maker's settlement transaction for the taker to sign, when supplied at quote time. */
  transaction?: string | null;
};

export type RfqTransport = (body: { inputMint: string; outputMint: string; amount: string; taker: string | null }, signal: AbortSignal) => Promise<{ ok: boolean; status: number; json: unknown }>;

export type RfqAdapterOptions = {
  /** Overrides HENAR_RFQ_URL. */
  url?: string | null;
  /** Overrides HENAR_RFQ_API_KEY. */
  apiKey?: string | null;
  /** Replaces the HTTP call (tests). */
  transport?: RfqTransport;
  /** Label for the source, e.g. the maker's name. */
  label?: string;
  timeoutMs?: number;
};

const RAW = /^\d{1,20}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function httpTransport(url: string, apiKey: string | null): RfqTransport {
  return async (body, signal) => {
    const res = await fetch(`${url.replace(/\/$/, "")}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  };
}

/** Validate a wire response into a firm quote, or explain why it is not one. */
export function parseFirmQuote(wire: unknown, request: QuoteRequest, now: number): { quote: RFQQuote; transaction: string | null } | { problem: string } {
  if (!wire || typeof wire !== "object") return { problem: "response is not an object" };
  const w = wire as RfqWire;
  if (typeof w.maker !== "string" || !w.maker) return { problem: "no maker" };
  if (w.inputMint !== request.inputMint || w.outputMint !== request.outputMint) return { problem: "pair differs from the request" };
  if (w.amountIn !== request.amount) return { problem: "amount differs from the request" };
  if (typeof w.amountOut !== "string" || !RAW.test(w.amountOut) || fromRaw(w.amountOut) <= 0n) return { problem: "amountOut is not a positive raw amount" };
  const expires = typeof w.expiresAt === "string" ? Date.parse(w.expiresAt) : NaN;
  if (!Number.isFinite(expires)) return { problem: "expiresAt is not a timestamp" };
  if (expires <= now) return { problem: "quote already expired" };
  if (typeof w.nonce !== "string" || !w.nonce) return { problem: "no nonce" };
  if (typeof w.signature !== "string" || !w.signature) return { problem: "no maker signature" };
  if (typeof w.settlementType !== "string" || !w.settlementType) return { problem: "no settlement type" };
  const price = (Number(w.amountOut) / Number(request.amount)).toString();
  return {
    quote: {
      maker: w.maker,
      representationId: request.representationId,
      side: request.side,
      amount: request.amount,
      price,
      output: w.amountOut,
      expiresAt: new Date(expires).toISOString(),
      nonce: w.nonce,
      signature: w.signature,
      settlementType: w.settlementType,
    },
    transaction: typeof w.transaction === "string" && w.transaction ? w.transaction : null,
  };
}

export class RfqAdapter implements VenueAdapter, RFQVenueAdapter {
  readonly venue = "rfq" as const;
  readonly maker: string;
  private readonly url: string | null;
  private readonly transport: RfqTransport | null;

  constructor(private readonly options: RfqAdapterOptions = {}) {
    this.url = options.url === undefined ? (process.env.HENAR_RFQ_URL ?? null) : options.url;
    const apiKey = options.apiKey === undefined ? (process.env.HENAR_RFQ_API_KEY ?? null) : options.apiKey;
    this.transport = options.transport ?? (this.url ? httpTransport(this.url, apiKey) : null);
    this.maker = options.label ?? "rfq";
  }

  capabilities(): VenueCapabilities {
    return { venue: this.venue, quote: true, legacyExecution: false, nativeBuild: false, poolTypes: [], supportsMinOut: true, supportsToken2022: true };
  }

  async health(): Promise<VenueHealth> {
    const configured = this.transport !== null;
    return { venue: this.venue, healthy: configured, checkedAt: new Date().toISOString(), detail: configured ? null : "HENAR_RFQ_URL is not set" };
  }

  async requestFirmQuote(request: QuoteRequest): Promise<RFQQuote | null> {
    const r = await this.firm(request, Date.now());
    return "quote" in r ? r.quote : null;
  }

  private async firm(request: QuoteRequest, now: number): Promise<{ quote: RFQQuote; transaction: string | null } | { problem: string; reason: "VENUE_NOT_CONFIGURED" | "VENUE_TIMEOUT" | "VENUE_UNHEALTHY" | "QUOTE_TERMS_MISMATCH" | "RATE_LIMIT_RETRY" }> {
    if (!this.transport) return { problem: "HENAR_RFQ_URL is not set", reason: "VENUE_NOT_CONFIGURED" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4_000);
    let res: Awaited<ReturnType<RfqTransport>>;
    try {
      res = await this.transport({ inputMint: request.inputMint, outputMint: request.outputMint, amount: request.amount, taker: request.wallet && BASE58.test(request.wallet) ? request.wallet : null }, controller.signal);
    } catch (error) {
      const message = (error as Error).message;
      return { problem: message, reason: /abort|timeout/i.test(message) ? "VENUE_TIMEOUT" : "VENUE_UNHEALTHY" };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) return { problem: "maker rate limited the request", reason: "RATE_LIMIT_RETRY" };
    if (!res.ok) return { problem: `maker returned HTTP ${res.status}`, reason: "VENUE_UNHEALTHY" };
    const parsed = parseFirmQuote(res.json, request, now);
    if ("problem" in parsed) return { problem: parsed.problem, reason: "QUOTE_TERMS_MISMATCH" };
    return parsed;
  }

  async getQuote(request: QuoteRequest, ctx: QuoteContext): Promise<VenueQuote> {
    if (request.amountType !== "input") return unavailableQuote(this.venue, request, "NOT_IMPLEMENTED", "exact-out", null, ctx.now);
    const r = await this.firm(request, ctx.now);
    if ("problem" in r) return unavailableQuote(this.venue, request, r.reason, r.problem, null, ctx.now);
    return {
      venue: this.venue,
      routeType: "DEX",
      representationId: request.representationId,
      poolAddress: null,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amountIn: request.amount,
      // A firm quote is the settlement amount; there is no slippage on it.
      expectedAmountOut: r.quote.output,
      minimumAmountOut: r.quote.output,
      effectivePrice: r.quote.price,
      venueFeeBps: null,
      venueFeeAmount: null,
      estimatedNetworkCostLamports: null,
      // Firm for the whole amount: no impact against a curve.
      priceImpactBps: 0,
      slot: null,
      quotedAt: new Date(ctx.now).toISOString(),
      expiresAt: r.quote.expiresAt,
      source: `rfq firm quote from ${r.quote.maker} (${r.quote.settlementType})`,
      // Settlement is the maker's transaction; the router cannot build it and
      // no client path validates it yet, so it ranks and never executes.
      executionPath: "none",
      onchainCheckedAtQuote: false,
      unavailableReason: null,
      unavailableDetail: null,
      rawRouteMetadata: { firmQuote: r.quote, transaction: r.transaction },
    };
  }

  async buildSwapInstructions(): Promise<BuildResult> {
    return { instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: "an RFQ settles through the maker's own transaction, not through the router builder" };
  }
}

export const rfqAdapter = new RfqAdapter();
