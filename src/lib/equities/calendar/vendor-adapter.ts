import { equityForTicker } from "../registry";
import {
  CALENDAR_COUNTRIES,
  type CalendarCountry,
  type CalendarEvent,
  type CalendarRange,
  type EarningsTiming,
} from "./types";

// Forward-looking earnings dates, analyst estimates and the macro calendar are
// not published by SEC EDGAR. This adapter targets Financial Modeling Prep,
// which covers both, and stays dormant until a key is configured. No part of
// the UI fabricates these values while it is dormant.
const ROOT = "https://financialmodelingprep.com/api/v3";
const TIMEOUT_MS = 8_000;

export function vendorKey() {
  return process.env.CALENDAR_API_KEY?.trim() || null;
}

export function vendorConfigured() {
  return Boolean(vendorKey());
}

export const VENDOR_NAME = "Financial Modeling Prep";

async function vendorJson<T>(path: string, range: CalendarRange): Promise<T> {
  const key = vendorKey();
  if (!key) throw new Error("Calendar provider is not configured.");
  const url = `${ROOT}/${path}?from=${range.start}&to=${range.end}&apikey=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    next: { revalidate: 1_800 },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Calendar request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function numeric(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

function timingFor(value: unknown): EarningsTiming {
  if (value === "bmo") return "before-open";
  if (value === "amc") return "after-close";
  if (value === "dmh") return "during";
  return null;
}

function surprisePct(actual: string | null, estimate: string | null) {
  if (!actual || !estimate) return null;
  const actualValue = Number(actual);
  const estimateValue = Number(estimate);
  if (!Number.isFinite(actualValue) || !Number.isFinite(estimateValue)) return null;
  if (estimateValue === 0) return null;
  return (((actualValue - estimateValue) / Math.abs(estimateValue)) * 100).toFixed(2);
}

type VendorEarnings = {
  date?: string;
  symbol?: string;
  eps?: number | null;
  epsEstimated?: number | null;
  time?: string;
};

/** Only companies that exist in the verified Henar catalog are surfaced. */
export async function vendorEarningsEvents(
  range: CalendarRange,
): Promise<CalendarEvent[]> {
  const rows = await vendorJson<VendorEarnings[]>("earning_calendar", range);
  if (!Array.isArray(rows)) return [];
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (!row?.date || !row?.symbol) continue;
    const equity = equityForTicker(row.symbol);
    if (!equity) continue;
    const actualEps = numeric(row.eps);
    const estimatedEps = numeric(row.epsEstimated);
    events.push({
      id: `earnings:${equity.ticker}:${row.date}`,
      type: "earnings",
      date: row.date.slice(0, 10),
      time: null,
      country: "US",
      ticker: equity.ticker,
      companyName: equity.name,
      companyLogo: equity.logo,
      eventName: null,
      timing: timingFor(row.time),
      estimatedEps,
      actualEps,
      surprise: surprisePct(actualEps, estimatedEps),
      previous: null,
      estimate: null,
      actual: null,
      marketCap: null,
      source: VENDOR_NAME,
      sourceUrl: null,
    });
  }
  return events;
}

const COUNTRY_BY_VENDOR_CODE: Record<string, CalendarCountry> = {
  US: "US",
  EU: "EU",
  CN: "CN",
  JP: "JP",
  GB: "UK",
  UK: "UK",
  CA: "CA",
};

type VendorMacro = {
  date?: string;
  country?: string;
  event?: string;
  previous?: number | null;
  estimate?: number | null;
  actual?: number | null;
};

export async function vendorMacroEvents(
  range: CalendarRange,
): Promise<CalendarEvent[]> {
  const rows = await vendorJson<VendorMacro[]>("economic_calendar", range);
  if (!Array.isArray(rows)) return [];
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    if (!row?.date || !row?.event) continue;
    const country = COUNTRY_BY_VENDOR_CODE[String(row.country).toUpperCase()];
    if (!country || !CALENDAR_COUNTRIES.includes(country)) continue;
    const [day, clock] = row.date.split(" ");
    events.push({
      id: `macro:${country}:${row.date}:${row.event}`,
      type: "macro",
      date: day,
      time: clock ? clock.slice(0, 5) : null,
      country,
      ticker: null,
      companyName: null,
      companyLogo: null,
      eventName: row.event,
      timing: null,
      estimatedEps: null,
      actualEps: null,
      surprise: null,
      previous: numeric(row.previous),
      estimate: numeric(row.estimate),
      actual: numeric(row.actual),
      marketCap: null,
      source: VENDOR_NAME,
      sourceUrl: null,
    });
  }
  return events;
}
