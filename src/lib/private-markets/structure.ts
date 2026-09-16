/**
 * Provider-supported descriptions of what each exposure product is. Every
 * sentence here paraphrases the provider's current public documentation or
 * API text (read 16 September 2026) and is attributed to it. Nothing here
 * calls a product a share of the referenced company.
 */
import type { PrivateProvider } from "./types";

export const PROVIDER_DOCS: Record<PrivateProvider, { site: string; docs: string; api: string; products: string; terms: string | null }> = {
  prestocks: {
    site: "https://prestocks.com",
    docs: "https://prestocks.com/products",
    api: "https://prestocks.com/api/prestocks",
    products: "https://prestocks.com/products",
    terms: "https://url.prestocks.com/terms-of-service",
  },
  tessera: {
    site: "https://www.tessera.pe",
    docs: "https://docs.tessera.pe",
    api: "https://rest-api.tessera.pe/v1/public/token-details",
    products: "https://app.tessera.pe",
    terms: "https://terms.tessera.pe",
  },
};

export const STRUCTURE: Record<PrivateProvider, { type: string; description: string; sourceUrl: string; attribution: string; howItWorks: string[] }> = {
  prestocks: {
    type: "SPV-backed price-tracking token",
    description:
      "PreStocks describes its tokens as tracking the price of a pre-IPO company, backed 1:1 by SPV exposure, and providing economic exposure only: no ownership, voting, dividend, information or other legal rights in the referenced company.",
    sourceUrl: "https://prestocks.com/products",
    attribution: "PreStocks product page and API description",
    howItWorks: [
      "Each token is described by PreStocks as backed 1:1 by SPV exposure that tracks the referenced private company's price.",
      "PreStocks publishes a mark price and mark valuation alongside the token's own price and implied valuation; the mark is the provider's figure, not an executable market price.",
      "Tokens are Solana Token-2022 mints issued by PreStocks; the on-chain state (transfer fee, permanent delegate, pausable, scaled UI amount) is read directly by Henar.",
      "PreStocks states its products are not available in the U.S., to U.S. persons, or to other ineligible persons.",
    ],
  },
  tessera: {
    type: "Loan participation right (T-Token)",
    description:
      "Tessera describes a T-Token as a loan participation right: acquiring it extends a loan to a dedicated issuer entity, and the token is a contractual right to a share of proceeds when a qualifying liquidity event occurs. Tessera states T-Tokens are structured as a loan product, not a security, and carry no ownership, voting or dividend rights in the referenced company.",
    sourceUrl: "https://docs.tessera.pe/overview/how-do-tessera-token-work",
    attribution: "Tessera documentation",
    howItWorks: [
      "A T-Token is a loan participation right against a dedicated issuer entity; repayment is a proportional share of proceeds from a qualifying liquidity event (IPO or change of control), per Tessera's redemption terms.",
      "T-Tokens are Solana Token-2022 mints with a transfer-fee extension; Tessera documents a 0.20% base fee charged when tokens are transferred or sold, and none on a USDC purchase.",
      "Tessera does not operate its own exchange: trading is routed to third-party Solana DEXs, with primary liquidity on Meteora.",
      "Tessera publishes a mark price, mark valuation and holder count for each product; the mark is the provider's figure, not an executable market price.",
      "Tessera's materials are not directed to persons in jurisdictions where such activity would be unlawful; the Terms and Conditions prevail.",
    ],
  },
};

export const ELIGIBILITY: Record<PrivateProvider, { note: string; sourceUrl: string }> = {
  prestocks: { note: "PreStocks states its products are not available in the U.S., to U.S. persons, or to other ineligible persons.", sourceUrl: "https://prestocks.com/products" },
  tessera: { note: "Tessera states its materials are not directed to persons in jurisdictions where such activity would be unlawful, and that its Terms and Conditions prevail.", sourceUrl: "https://terms.tessera.pe" },
};
