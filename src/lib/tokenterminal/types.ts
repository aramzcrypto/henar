import type { DataProvenance } from "@/lib/provenance";
import type { IssuerId } from "@/lib/issuers/types";

export type TokenTerminalAvailability =
  | "AVAILABLE"
  | "NOT_CONFIGURED"
  | "INVALID_KEY"
  | "NOT_ENTITLED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

/** One Henar mint matched to a Token Terminal asset, with the evidence. */
export type TokenTerminalMatch = {
  mint: string;
  assetId: string;
  symbol: string | null;
  name: string | null;
  assetType: string | null;
  /** What the asset tracks, in Token Terminal's own terms. */
  referenceAssetId: string | null;
  /** Chain ids the asset is listed on, as returned. */
  chains: string[];
  /** Projects Token Terminal attributes the asset to, and how. */
  issuers: { projectId: string; relation: string | null }[];
};

export type TokenTerminalAssetMetrics = {
  assetId: string;
  marketCapUsd: number | null;
  holders: number | null;
  transferVolumeUsd: number | null;
  priceUsd: number | null;
};

export type TokenTerminalCoverage = {
  status: TokenTerminalAvailability;
  keyConfigured: boolean;
  detail: string;
  /** Assets in Token Terminal's catalog with at least one address. */
  catalogAssets: number | null;
  /** Henar mints matched to an asset, over mints queried. */
  mintsMatched: number | null;
  mintsQueried: number;
  byIssuer: Record<IssuerId, { mints: number; matched: number | null }>;
  /** Distinct reference assets the matched tokens track. */
  referenceAssets: string[];
  metricsAvailable: string[];
  checkedAt: string;
  provenance: DataProvenance;
};
