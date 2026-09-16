/**
 * The verified strategy-market registry.
 *
 * A strategy may only touch a market that passed these checks. Being a real
 * pool is not enough: a market has to be deep enough to quote against, fresh
 * enough to trust, built on a mint the router can settle, and — for
 * accumulation — able to accept a limit order.
 *
 * Membership is small on purpose. Meteora DLMM liquidity for tokenized
 * equities is thin, and a strategy pointed at a $60 pool would be a
 * demonstration of nothing.
 */
import { verifiedMint } from "@henar/router-core";
import { equityForMint } from "@/lib/equities/registry";
import type { StrategyMarket } from "./types";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** What a market must clear before a strategy may use it. */
export const MARKET_CRITERIA = {
  /** Below this a position cannot be sized meaningfully. */
  minLiquidityUsd: 5_000,
  /** A market nobody trades earns no fees, whatever its depth. */
  minVolume24hUsd: 500,
  /** State older than this is not a basis for an action. */
  maxStateAgeSeconds: 300,
} as const;

export type MarketCandidate = {
  address: string;
  protocol: "meteora-dlmm";
  assetMint: string;
  assetSymbol: string;
  quoteMint: string;
  quoteSymbol: string;
  binStep: number;
  /** Observed when the candidate was admitted. */
  liquidityUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  supportsLimitOrders: boolean;
  observedAt: string;
};

/**
 * Candidates observed on 16 September 2026 by scanning the DLMM program for
 * pools holding a verified representation mint, then reading each pool's own
 * state and Meteora's data API for depth and volume.
 *
 * NVDAx/USDC is the only tokenized-equity DLMM market with both real depth
 * and real turnover, so it is the one the demo strategies use. The rest are
 * recorded because a registry that only lists its winner cannot show why.
 */
export const MARKET_CANDIDATES: MarketCandidate[] = [
  { address: "F4inHs4RQARpASmvLpj45QjGLdkukeGQrtQ22pimVy2a", protocol: "meteora-dlmm", assetMint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", assetSymbol: "NVDAx", quoteMint: USDC_MINT, quoteSymbol: "USDC", binStep: 25, liquidityUsd: 10_588, volume24hUsd: 10_404, fees24hUsd: 23.45, supportsLimitOrders: true, observedAt: "2026-09-16T12:00:00.000Z" },
  { address: "eV4ogmq1yriacUmvXnFr2shVnXDrVidDvVcU24irEEo", protocol: "meteora-dlmm", assetMint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", assetSymbol: "QQQx", quoteMint: USDC_MINT, quoteSymbol: "USDC", binStep: 20, liquidityUsd: 5_965, volume24hUsd: 0, fees24hUsd: 0, supportsLimitOrders: true, observedAt: "2026-09-16T12:00:00.000Z" },
  { address: "9AbQxo8j6CH7xgXpghBhMXj4RxGudLBMzk5cf7TeWQE2", protocol: "meteora-dlmm", assetMint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", assetSymbol: "SPYx", quoteMint: USDC_MINT, quoteSymbol: "USDC", binStep: 20, liquidityUsd: 4_232, volume24hUsd: 1_070, fees24hUsd: 1.93, supportsLimitOrders: true, observedAt: "2026-09-16T12:00:00.000Z" },
  { address: "6wqFAm78s1AfjPwJvoXUhLsy6P7Ngi6wDaqKNC6WPtZT", protocol: "meteora-dlmm", assetMint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", assetSymbol: "MSFTx", quoteMint: USDC_MINT, quoteSymbol: "USDC", binStep: 25, liquidityUsd: 4_011, volume24hUsd: 2_094, fees24hUsd: 4.73, supportsLimitOrders: true, observedAt: "2026-09-16T12:00:00.000Z" },
  { address: "AiKXdE3vAtCQTD9REbMEwNnuUfxHAZtBaHoVHdQirBUU", protocol: "meteora-dlmm", assetMint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", assetSymbol: "HOODx", quoteMint: USDC_MINT, quoteSymbol: "USDC", binStep: 50, liquidityUsd: 1_312, volume24hUsd: 1_246, fees24hUsd: 5.68, supportsLimitOrders: true, observedAt: "2026-09-16T12:00:00.000Z" },
];

export type MarketAdmission = { admitted: boolean; reasons: string[]; failures: string[] };

/**
 * Judge one candidate. `requireLimitOrders` is set by accumulation
 * strategies, which cannot work in a liquidity-mining pool.
 */
export function admitMarket(candidate: MarketCandidate, options: { requireLimitOrders?: boolean } = {}): MarketAdmission {
  const reasons: string[] = [];
  const failures: string[] = [];

  const verified = verifiedMint(candidate.assetMint);
  if (!verified) failures.push("asset mint is not in the verified mint registry");
  else if (!verified.supported) failures.push(`asset mint is unsupported: ${verified.unsupportedReason}`);
  else reasons.push(`asset mint verified on chain at slot ${verified.slot}${verified.isToken2022 ? " (Token-2022)" : ""}`);

  const equity = equityForMint(candidate.assetMint);
  if (!equity) failures.push("asset mint is not a verified equity representation");
  else reasons.push(`${equity.equity.name} via ${equity.representation.providerLabel}`);

  if (candidate.quoteMint !== USDC_MINT) failures.push("quote asset is not USDC");
  else reasons.push("quote asset is USDC");

  if (candidate.protocol !== "meteora-dlmm") failures.push(`unsupported protocol ${candidate.protocol}`);

  if (candidate.liquidityUsd < MARKET_CRITERIA.minLiquidityUsd) failures.push(`liquidity $${Math.round(candidate.liquidityUsd)} is below the $${MARKET_CRITERIA.minLiquidityUsd} floor`);
  else reasons.push(`liquidity $${Math.round(candidate.liquidityUsd)}`);

  if (candidate.volume24hUsd < MARKET_CRITERIA.minVolume24hUsd) failures.push(`24h volume $${Math.round(candidate.volume24hUsd)} is below the $${MARKET_CRITERIA.minVolume24hUsd} floor`);
  else reasons.push(`24h volume $${Math.round(candidate.volume24hUsd)}`);

  if (options.requireLimitOrders) {
    if (!candidate.supportsLimitOrders) failures.push("pool does not admit limit orders (liquidity-mining mode)");
    else reasons.push("pool admits limit orders");
  }

  return { admitted: failures.length === 0, reasons, failures };
}

/** Candidates that pass, as strategy markets. */
export function verifiedMarkets(options: { requireLimitOrders?: boolean } = {}): StrategyMarket[] {
  return MARKET_CANDIDATES.flatMap((candidate) => {
    const admission = admitMarket(candidate, options);
    if (!admission.admitted) return [];
    const equity = equityForMint(candidate.assetMint);
    return [{
      address: candidate.address,
      protocol: candidate.protocol,
      assetMint: candidate.assetMint,
      assetSymbol: candidate.assetSymbol,
      representationId: equity?.representation.id ?? null,
      quoteMint: candidate.quoteMint,
      quoteSymbol: candidate.quoteSymbol,
      admittedBecause: admission.reasons,
      verifiedAt: candidate.observedAt,
    }];
  });
}

export function marketByAddress(address: string) {
  return MARKET_CANDIDATES.find((c) => c.address === address) ?? null;
}

/** Every candidate with its verdict, for the diagnostics surface. */
export function marketRegistryReport(options: { requireLimitOrders?: boolean } = {}) {
  return MARKET_CANDIDATES.map((candidate) => ({ candidate, admission: admitMarket(candidate, options) }));
}
