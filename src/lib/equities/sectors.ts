import sectorData from "@/data/sectors.json";

/**
 * Sector classification is derived from the SIC code each company reports to
 * SEC EDGAR. Nothing here is inferred from a token symbol or a product name.
 * The generated index is built by `npm run sectors:build`.
 */
export const SECTORS = [
  "Technology",
  "Health Care",
  "Financials",
  "Consumer",
  "Industrials",
  "Energy",
  "Materials",
  "Utilities",
  "Real Estate",
  "Communications",
  "Transportation",
  "Funds & ETFs",
] as const;

export type Sector = (typeof SECTORS)[number];

type SectorRecord = { sector: Sector; sic: string; industry: string };
const index = sectorData as Record<string, SectorRecord>;

/**
 * Maps a four-digit SIC code onto a readable sector. Ranges follow the SEC's
 * own SIC division structure, with the finance division split so that real
 * estate and investment trusts do not sit inside Financials.
 */
export function sectorForSic(sic: string | number | null): Sector | null {
  const code = Number(sic);
  if (!Number.isFinite(code) || code <= 0) return null;

  // Investment offices, unit trusts and blank checks are funds, not operating
  // companies, so they are separated before the finance range is considered.
  if ((code >= 6722 && code <= 6726) || code === 6770 || code === 6199)
    return "Funds & ETFs";
  if (code >= 6500 && code <= 6553) return "Real Estate";
  if (code === 6798) return "Real Estate";
  if (code >= 6000 && code <= 6499) return "Financials";
  if (code >= 6700 && code <= 6799) return "Financials";

  if (code >= 100 && code <= 999) return "Materials"; // Agriculture
  if (code >= 1000 && code <= 1299) return "Materials"; // Metal and coal mining
  if (code >= 1300 && code <= 1399) return "Energy"; // Oil and gas extraction
  if (code >= 1400 && code <= 1499) return "Materials";
  if (code >= 1500 && code <= 1799) return "Industrials"; // Construction

  if (code >= 2000 && code <= 2199) return "Consumer"; // Food, beverages, tobacco
  if (code >= 2200 && code <= 2399) return "Consumer"; // Textiles and apparel
  if (code >= 2400 && code <= 2499) return "Materials"; // Lumber
  if (code >= 2500 && code <= 2599) return "Consumer"; // Furniture
  if (code >= 2600 && code <= 2699) return "Materials"; // Paper
  if (code >= 2700 && code <= 2799) return "Communications"; // Publishing
  if (code >= 2800 && code <= 2829) return "Materials"; // Industrial chemicals
  if (code >= 2830 && code <= 2836) return "Health Care"; // Pharmaceuticals
  if (code >= 2840 && code <= 2899) return "Materials";
  if (code >= 2900 && code <= 2999) return "Energy"; // Petroleum refining
  if (code >= 3000 && code <= 3299) return "Materials";
  if (code >= 3300 && code <= 3399) return "Materials"; // Primary metals
  if (code >= 3400 && code <= 3569) return "Industrials";
  if (code >= 3570 && code <= 3579) return "Technology"; // Computer hardware
  if (code >= 3580 && code <= 3599) return "Industrials";
  if (code >= 3600 && code <= 3651) return "Technology"; // Electronics
  if (code >= 3652 && code <= 3652) return "Communications";
  if (code >= 3660 && code <= 3699) return "Technology"; // Comms equipment
  if (code >= 3700 && code <= 3799) return "Industrials"; // Transport equipment
  if (code >= 3800 && code <= 3851) return "Health Care"; // Medical instruments
  if (code >= 3860 && code <= 3999) return "Industrials";

  if (code >= 4000 && code <= 4599) return "Transportation";
  if (code >= 4600 && code <= 4699) return "Energy"; // Pipelines
  if (code >= 4700 && code <= 4799) return "Transportation";
  if (code >= 4800 && code <= 4899) return "Communications";
  if (code >= 4900 && code <= 4999) return "Utilities";

  if (code >= 5000 && code <= 5199) return "Industrials"; // Wholesale
  if (code >= 5200 && code <= 5999) return "Consumer"; // Retail

  if (code >= 7000 && code <= 7299) return "Consumer";
  if (code >= 7370 && code <= 7379) return "Technology"; // Software and services
  if (code === 7372 || code === 7371 || code === 7389) return "Technology";
  if (code >= 7300 && code <= 7399) return "Industrials";
  if (code >= 7800 && code <= 7999) return "Communications"; // Media
  if (code >= 8000 && code <= 8099) return "Health Care";
  if (code >= 8100 && code <= 8999) return "Industrials";

  return null;
}

export function sectorForTicker(ticker: string): Sector | null {
  return index[ticker.toUpperCase()]?.sector ?? null;
}

export function industryForTicker(ticker: string): string | null {
  return index[ticker.toUpperCase()]?.industry ?? null;
}

export function sectorCoverage() {
  return Object.keys(index).length;
}
