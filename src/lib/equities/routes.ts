import Decimal from "decimal.js";
import type {
  EquityRoute,
  QuoteAlternative,
  Representation,
  RepresentationCapabilities,
  EarnOpportunity,
} from "./types";

export function dexRoute(
  quote: QuoteAlternative,
  side: "buy" | "sell",
): EquityRoute {
  return {
    id: `${quote.representationId}:${quote.routeType}:${quote.quoteProvider}:${side}`,
    representationId: quote.representationId,
    provider: quote.provider,
    tokenSymbol: quote.tokenSymbol,
    mint: quote.mint,
    routeType: quote.routeType,
    venue: quote.quoteProvider,
    side,
    availability: "available",
    eligibilityRequirements: quote.eligibilityRequirements,
    settlementNotes: quote.settlementNotes,
    destinationUrl: `/trade?stock=${quote.mint}`,
    sourceUrl: "",
    checkedAt: quote.quotedAt,
    quote: {
      inputAmount: quote.inputAmount,
      inputUnit: side === "buy" ? "USDC" : quote.mint,
      outputAmount: quote.expectedReceivedAmount,
      outputUnit: side === "buy" ? "displayed_share" : "USDC",
      effectivePrice: quote.effectivePrice,
      fees: {
        providerFeeBps: quote.providerFeeBps,
        protocolFeeAmount: quote.protocolFeeAmount,
        networkFeeAmount: quote.networkFeeAmount,
      },
      priceImpactPct: quote.priceImpactPct,
      expiresAt: quote.expiresAt,
    },
  };
}

/** Only like-for-like, fresh net quotes can win. Entitlements without an all-in
 * funding/withdrawal quote cannot compete with wallet-delivered token quotes.
 * Ranking excludes unknown network fees; the UI explicitly states this scope.
 */
export function bestNetRoute(
  routes: EquityRoute[],
  side: "buy" | "sell",
  amount: string,
  now = Date.now(),
): EquityRoute | null {
  const candidates = routes.filter((route) => {
    const q = route.quote;
    if (
      !q ||
      route.side !== side ||
      route.availability !== "available" ||
      Date.parse(q.expiresAt) <= now ||
      !Number.isFinite(Date.parse(q.expiresAt))
    )
      return false;
    try {
      return (
        new Decimal(q.inputAmount).eq(amount) &&
        new Decimal(q.outputAmount).isFinite() &&
        new Decimal(q.outputAmount).gt(0) &&
        new Decimal(q.effectivePrice).isFinite() &&
        new Decimal(q.effectivePrice).gt(0) &&
        q.fees.providerFeeBps !== null &&
        q.fees.protocolFeeAmount !== null &&
        (side === "buy"
          ? q.inputUnit === "USDC" && q.outputUnit === "displayed_share"
          : q.outputUnit === "USDC")
      );
    } catch {
      return false;
    }
  });
  // Selling different issuer tokens is not a substitutable input balance.
  if (
    side === "sell" &&
    new Set(candidates.map((r) => r.quote!.inputUnit)).size > 1
  )
    return null;
  return (
    candidates.sort((a, b) =>
      new Decimal(b.quote!.outputAmount).cmp(a.quote!.outputAmount),
    )[0] ?? null
  );
}

export function capabilitiesFor(
  representation: Representation,
  routes: EquityRoute[],
  earn: EarnOpportunity[],
  traditionalClosed: boolean,
): RepresentationCapabilities {
  const supported = routes.filter(
    (r) =>
      r.representationId === representation.id &&
      r.availability !== "unavailable",
  );
  const has = (type: EquityRoute["routeType"]) =>
    supported.some((r) => r.routeType === type);
  const active = supported.some(
    (r) =>
      r.availability === "available" &&
      r.quote &&
      Date.parse(r.quote.expiresAt) > Date.now(),
  );
  const opportunities = earn.filter(
    (o) =>
      o.representationId === representation.id && o.status !== "unavailable",
  );
  return {
    tradeCapabilities: {
      dexSwap: has("DEX"),
      rfq: has("RFQ"),
      primaryMint: has("PRIMARY_MINT"),
      primaryRedeem: has("PRIMARY_REDEEM"),
    },
    earnCapabilities: {
      lending: opportunities.some((o) => o.opportunityType === "lending"),
      vault: opportunities.some((o) => o.opportunityType === "vault"),
      liquidityPool: opportunities.some(
        (o) => o.opportunityType === "liquidity_pool",
      ),
    },
    marketCapabilities: {
      secondaryTrading: has("DEX") || has("RFQ"),
      primaryMarket: has("PRIMARY_MINT") || has("PRIMARY_REDEEM"),
      transfers: has("PRIMARY_MINT") || has("PRIMARY_REDEEM"),
      afterHoursTrading: traditionalClosed && active,
    },
  };
}
