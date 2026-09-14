// Provider-independent calendar contract. Every adapter normalizes into this
// shape so the UI never depends on a specific upstream vendor.
export type CalendarEventType = "earnings" | "macro";

export type CalendarCountry = "US" | "EU" | "CN" | "JP" | "UK" | "CA";

export const CALENDAR_COUNTRIES: CalendarCountry[] = [
  "US",
  "EU",
  "CN",
  "JP",
  "UK",
  "CA",
];

export const COUNTRY_LABELS: Record<CalendarCountry, string> = {
  US: "United States",
  EU: "Euro Area",
  CN: "China",
  JP: "Japan",
  UK: "United Kingdom",
  CA: "Canada",
};

export const COUNTRY_FLAGS: Record<CalendarCountry, string> = {
  US: "🇺🇸",
  EU: "🇪🇺",
  CN: "🇨🇳",
  JP: "🇯🇵",
  UK: "🇬🇧",
  CA: "🇨🇦",
};

/** Reporting slot relative to the regular session. */
export type EarningsTiming = "before-open" | "after-close" | "during" | null;

export type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  /** Calendar day in YYYY-MM-DD, in exchange-local terms. */
  date: string;
  /** HH:MM in UTC when the upstream source publishes one. */
  time: string | null;
  country: CalendarCountry;
  /** Earnings only. Links to the canonical Henar company page. */
  ticker: string | null;
  companyName: string | null;
  companyLogo: string | null;
  /** Macro only. */
  eventName: string | null;
  timing: EarningsTiming;
  estimatedEps: string | null;
  actualEps: string | null;
  /** Percentage surprise as a decimal string when both sides are known. */
  surprise: string | null;
  previous: string | null;
  estimate: string | null;
  actual: string | null;
  marketCap: string | null;
  source: string;
  sourceUrl: string | null;
};

/**
 * A feed is either connected and returning verified events, or explicitly not
 * connected. There is no in-between state that renders invented events.
 */
export type CalendarFeed = {
  status: "available" | "not-connected";
  events: CalendarEvent[];
  /** Human-readable provider name when connected. */
  provider: string | null;
  asOf: string | null;
  /** Set when status is "not-connected" to explain the gap honestly. */
  note: string | null;
};

export type CalendarRange = { start: string; end: string };

export type CalendarResponse = {
  range: CalendarRange;
  earnings: CalendarFeed;
  macro: CalendarFeed;
};

export type CalendarProvider = {
  name: string;
  /** Adapters report their own readiness from environment configuration. */
  isConfigured(): boolean;
  earnings(range: CalendarRange): Promise<CalendarEvent[]>;
  macro(range: CalendarRange): Promise<CalendarEvent[]>;
};
