/**
 * Backpack Securities, read from Backpack's own public API.
 *
 * Backpack is the largest issuer in Henar's catalog by mint count and the
 * most tightly gated in practice. A security listed on the exchange is not a
 * token anyone can hold: the token only exists on Solana once the entitlement
 * is withdrawn, and the issuer enables withdrawal and deposit per asset. So
 * the number that describes this issuer is not how many securities it lists
 * but how many of them can actually leave the exchange today.
 *
 * The snapshot is the same one the company pages already use, so this adds no
 * request of its own. Sources are `/assets`, `/securities` and `/markets`,
 * all public. Read 20 September 2026: https://docs.backpack.exchange/
 */
import { backpackSnapshot, BACKPACK_DOCS, type BackpackSnapshot } from "@/lib/equities/providers/backpack-primary";
import { provenance } from "@/lib/provenance";
import { issuerRepresentations } from "../profiles";
import type { IssuerDisclosure, IssuerMeasure } from "../types";

export const BACKPACK_API = "https://api.backpack.exchange/api/v1";

/**
 * Solana tokens whose asset is also a listed security. A brokerage listing
 * alone never counts, and neither does a matching ticker: the asset must
 * carry a Solana contract address in `/assets` and appear in `/securities`.
 */
export function tokenizedSecurities(snapshot: BackpackSnapshot) {
  const securities = new Set(snapshot.securities.map((security) => security.asset));
  return snapshot.assets.flatMap((asset) =>
    securities.has(asset.symbol)
      ? asset.tokens
          .filter((token) => token.blockchain === "Solana" && token.contractAddress)
          .map((token) => ({ asset: asset.symbol, ...token }))
      : [],
  );
}

export function summarizeBackpack(snapshot: BackpackSnapshot, verifiedMints: Set<string>): IssuerMeasure[] {
  const tokens = tokenizedSecurities(snapshot);
  const withdrawable = tokens.filter((token) => token.withdrawEnabled).length;
  const depositable = tokens.filter((token) => token.depositEnabled).length;
  const matched = tokens.filter((token) => token.contractAddress && verifiedMints.has(token.contractAddress)).length;
  const sessions = new Set(
    snapshot.securities.flatMap((security) => security.sessions.map((session) => session.name)),
  );
  const securityMarkets = snapshot.markets.filter((market) =>
    snapshot.securities.some((security) => security.asset === market.baseSymbol),
  );
  const spot = securityMarkets.filter((market) => market.marketType === "SPOT").length;
  const perp = securityMarkets.filter((market) => market.marketType !== "SPOT").length;
  return [
    { id: "catalogAssets", label: "Securities listed", value: snapshot.securities.length, unit: "count", detail: "Tradable securities on the exchange" },
    { id: "solanaAssets", label: "With a Solana token", value: tokens.length, unit: "count" },
    {
      id: "henarVerified",
      label: "Verified in Henar",
      value: matched,
      unit: "count",
      detail: "Issuer-published Solana addresses matching a verified Henar mint",
    },
    {
      id: "onchainWithdraw",
      label: "Withdrawal enabled",
      value: withdrawable,
      unit: "count",
      detail: "Entitlements the issuer will release onchain right now",
    },
    {
      id: "onchainDeposit",
      label: "Deposit enabled",
      value: depositable,
      unit: "count",
      detail: "Tokens the issuer will accept back into an entitlement",
    },
    {
      id: "exchangeSpot",
      label: "Spot markets",
      value: spot,
      unit: "count",
      detail: "On the issuer's own order book, in USDC",
    },
    {
      id: "exchangePerp",
      label: "Perpetual markets",
      value: perp,
      unit: "count",
      detail: "A perpetual is a derivative on the security, not the token",
    },
    {
      id: "sessions",
      label: "Trading sessions",
      value: sessions.size,
      unit: "count",
      detail: [...sessions].map((name) => name.replace(/^US_EQUITIES_/, "").toLowerCase()).join(", ") || null,
    },
  ];
}

export async function backpackDisclosure(
  options: { snapshot?: () => Promise<BackpackSnapshot> } = {},
): Promise<IssuerDisclosure> {
  const observedAt = new Date().toISOString();
  const base = {
    source: "Backpack Securities",
    sourceUrl: BACKPACK_DOCS,
    provenance: provenance({
      source: "Backpack Securities",
      provider: "backpack",
      sourceType: "provider-catalog",
      observedAt,
      freshness: "fresh",
      url: BACKPACK_API,
    }),
  };
  try {
    const snapshot = await (options.snapshot ?? backpackSnapshot)();
    const verified = new Set(issuerRepresentations("backpack").map((item) => item.mint));
    return {
      ...base,
      status: "available" as const,
      measures: summarizeBackpack(snapshot, verified),
      /* Backpack's public metadata describes Solana tokens only, so no other
         chain is claimed for it here. */
      networks: ["Solana"],
      reserves: null,
      reason: null,
    };
  } catch (error) {
    return {
      ...base,
      status: "unavailable" as const,
      measures: [],
      networks: [],
      reserves: null,
      reason: (error as Error).message,
    };
  }
}
