/**
 * Issuer intelligence: what each tokenized-stock issuer actually is, what it
 * publishes about itself, and what its tokens do on Solana.
 *
 * Henar groups by company. This layer is the other axis — the issuer — and it
 * exists because the differences between xStocks, Backpack Securities and
 * Ondo are the product. A representation is not a company's share; it is one
 * issuer's instrument, with its own backing, its own redemption terms, its
 * own chains and its own liquidity. Those facts are read from each issuer's
 * own public source and from chain, never inferred from one another.
 *
 * Every block carries its provenance and its own availability. An issuer that
 * publishes no source for something reports `unavailable` with the reason;
 * nothing here is estimated to fill a gap.
 */
import type { DataProvenance } from "@/lib/provenance";
import type { EquityProvider } from "@/lib/equities/types";

export type IssuerId = EquityProvider;
export const ISSUER_IDS: readonly IssuerId[] = ["xstocks", "backpack", "ondo"] as const;

export type SourceStatus = "available" | "unavailable" | "not_configured";

/** Unit of a measured issuer fact, so the UI formats without guessing. */
export type MeasureUnit = "count" | "usd" | "percent" | "ratio" | "text";

/**
 * One measured fact about an issuer, read from that issuer's own source.
 *
 * `id` is stable across issuers where the fact means the same thing, so the
 * comparison table can line rows up. A `null` value means the issuer's source
 * does not publish it, and it is rendered as unavailable rather than zero.
 */
export type IssuerMeasure = {
  id: string;
  label: string;
  value: number | string | null;
  unit: MeasureUnit;
  detail?: string | null;
};

/** Registry-derived catalog scale. Static, exact, no network. */
export type IssuerCatalog = {
  companies: number;
  representations: number;
  stocks: number;
  etfs: number;
  /** Companies only this issuer represents in Henar's catalog. */
  soleIssuer: number;
  /** Companies every issuer represents. */
  sharedWithAll: number;
};

export type IssuerMintMarket = {
  mint: string;
  tokenSymbol: string;
  ticker: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  marketCapUsd: number | null;
};

/**
 * What this issuer's tokens do on Solana, aggregated across every verified
 * mint Henar holds for it. Counts are as important as totals: an issuer with
 * a thousand mints and fifty live markets is a different product from an
 * issuer with fifty of each, and the difference is invisible in a total.
 */
export type IssuerMarket = {
  status: SourceStatus;
  mintsQueried: number;
  /** Mints the market source returned any live figure for. */
  mintsWithMarket: number;
  /** Mints with a non-zero 24h traded volume. */
  tradedMints: number;
  pricedMints: number;
  mintsWithLiquidity: number;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  traders24h: number | null;
  top: IssuerMintMarket[];
  reason: string | null;
  provenance: DataProvenance;
};

/**
 * Registered versus actually issued.
 *
 * A mint address in a catalog is a promise; supply on the mint is the thing
 * itself. The gap between them is the single most informative number about an
 * issuer, and it exists nowhere except the chain.
 */
export type IssuerOnchainPresence = {
  status: SourceStatus;
  /** Verified mints Henar holds for this issuer. */
  registered: number;
  /** Of those, the ones holding any supply. Null when unread. */
  live: number | null;
  /** Mints whose account was actually read. */
  read: number;
  reason: string | null;
  provenance: DataProvenance;
};

/** Token-backing evidence, where the issuer publishes it. */
export type IssuerReserves = {
  status: SourceStatus;
  /** Assets the issuer publishes a reserve record for. */
  assets: number;
  /** Records where held shares are at least the circulating token supply. */
  fullyBacked: number;
  /** Records with a circulating supply large enough to compute a ratio. */
  comparable: number;
  minRatio: number | null;
  medianRatio: number | null;
  custodians: { name: string; assets: number }[];
  observedAt: string | null;
  reason: string | null;
  sourceUrl: string;
};

/**
 * The issuer's own public source: what it publishes about its instrument.
 * Measures are whatever that source actually returns, so a wider API widens
 * the block with no change here.
 */
export type IssuerDisclosure = {
  status: SourceStatus;
  source: string;
  sourceUrl: string;
  measures: IssuerMeasure[];
  reserves: IssuerReserves | null;
  /** Chains the issuer deploys the same instrument on, where it says. */
  networks: string[];
  reason: string | null;
  provenance: DataProvenance;
};

/** Static, verified issuer identity. Never live, never guessed. */
export type IssuerProfile = {
  id: IssuerId;
  label: string;
  /** The legal issuing entity, as the issuer states it. */
  issuer: string;
  logo: string;
  issuerUrl: string;
  /** The public source Henar reads this issuer's disclosures from, if any. */
  apiUrl: string | null;
  docsUrl: string;
  instrument: string;
  redemptionModel: string | null;
  tokenSuffix: string;
};

export type IssuerSnapshot = {
  profile: IssuerProfile;
  catalog: IssuerCatalog;
  presence: IssuerOnchainPresence;
  market: IssuerMarket;
  disclosure: IssuerDisclosure;
  /** Token Terminal asset coverage for this issuer, when a key is configured. */
  external: IssuerExternalCoverage | null;
};

/**
 * Token Terminal's view of this issuer's tokens. Kept separate from the
 * issuer's own disclosures and from Henar's market reads: it is a third
 * party's dataset, and it is labelled as one.
 */
export type IssuerExternalCoverage = {
  status: SourceStatus;
  source: string;
  sourceUrl: string;
  /** Henar mints for this issuer that Token Terminal lists as an asset. */
  mintsMapped: number;
  mintsQueried: number;
  measures: IssuerMeasure[];
  reason: string | null;
  provenance: DataProvenance;
};

export type IssuerSourceStatus = {
  id: string;
  label: string;
  status: SourceStatus;
  url: string | null;
  reason: string | null;
  /** What Henar takes from this source, in one line. */
  role: string;
};

/** One issuer's own page: its snapshot, its sources, and the other issuers. */
export type IssuerProfileData = IssuerSnapshot & {
  sources: IssuerSourceStatus[];
  peers: { id: IssuerId; label: string; logo: string }[];
  generatedAt: string;
};

export type IssuerIntelligence = {
  issuers: IssuerSnapshot[];
  sources: IssuerSourceStatus[];
  totals: {
    companies: number;
    representations: number;
    tradedMints: number;
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    holders: number | null;
  };
  generatedAt: string;
};
