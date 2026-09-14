import { jupiterMetadata } from "../jupiter";
import { equityRegistry } from "../registry";
import { loadResearchForEquity } from "../research";
import { readResearchFileCache } from "../research-file-cache";
import type { Equity } from "../types";
import type { CalendarEvent, CalendarRange } from "./types";

// SEC EDGAR publishes the date each result was actually filed along with the
// reported EPS. Those are verifiable, already-happened earnings events, so they
// are safe to render. EDGAR carries no forward-looking dates and no analyst
// estimates, so this adapter never produces them.
const COVERAGE_LIMIT = 80;
const WARM_PER_REQUEST = 6;
const WARM_BUDGET_MS = 8_000;

/**
 * Companies carrying the most verified representations are the ones a Henar
 * user is most likely to look up, so they define calendar coverage.
 */
function coverage(): Equity[] {
  return [...equityRegistry]
    .sort(
      (a, b) =>
        b.representations.length - a.representations.length ||
        a.ticker.localeCompare(b.ticker),
    )
    .slice(0, COVERAGE_LIMIT);
}

function surprisePct(actual: string | null, estimate: string | null) {
  if (!actual || !estimate) return null;
  const actualValue = Number(actual);
  const estimateValue = Number(estimate);
  if (!Number.isFinite(actualValue) || !Number.isFinite(estimateValue)) return null;
  if (estimateValue === 0) return null;
  return (
    ((actualValue - estimateValue) / Math.abs(estimateValue)) *
    100
  ).toFixed(2);
}

function toEvents(equity: Equity, research: Awaited<ReturnType<typeof loadResearchForEquity>>) {
  if (research.earnings.status !== "available" || !research.earnings.data)
    return [] as CalendarEvent[];
  return research.earnings.data.map((event): CalendarEvent => ({
    id: `earnings:${equity.ticker}:${event.reportedAt}:${event.fiscalPeriod}`,
    type: "earnings",
    date: event.reportedAt.slice(0, 10),
    time: null,
    country: "US",
    ticker: equity.ticker,
    companyName: equity.name,
    companyLogo: equity.logo,
    eventName: event.fiscalPeriod || null,
    timing: null,
    estimatedEps: event.estimatedEps,
    actualEps: event.actualEps,
    surprise: surprisePct(event.actualEps, event.estimatedEps),
    previous: null,
    estimate: null,
    actual: null,
    marketCap: null,
    source: "SEC EDGAR",
    sourceUrl: research.earnings.sourceUrl,
  }));
}

/**
 * Reads whatever SEC research is already cached and warms a small number of
 * additional companies within a fixed time budget. Coverage therefore grows
 * across requests without any single request paying to download every filing.
 */
export async function secEarningsEvents(
  range: CalendarRange,
): Promise<CalendarEvent[]> {
  const companies = coverage();
  const events: CalendarEvent[] = [];
  const cold: Equity[] = [];

  const cached = await Promise.all(
    companies.map(async (equity) => ({
      equity,
      research: await readResearchFileCache(equity.ticker),
    })),
  );
  for (const entry of cached) {
    if (entry.research) events.push(...toEvents(entry.equity, entry.research));
    else cold.push(entry.equity);
  }

  const deadline = Date.now() + WARM_BUDGET_MS;
  for (const equity of cold.slice(0, WARM_PER_REQUEST)) {
    if (Date.now() > deadline) break;
    try {
      events.push(...toEvents(equity, await loadResearchForEquity(equity)));
    } catch {
      // A single unavailable company must not empty the calendar.
    }
  }

  const deduped = new Map<string, CalendarEvent>();
  for (const event of events) {
    // The same filing surfaces under several EPS concepts. One row per
    // company per reporting date is what a calendar should show.
    const key = `${event.ticker}:${event.date}`;
    if (!deduped.has(key)) deduped.set(key, event);
  }

  const inRange = [...deduped.values()]
    .filter((event) => event.date >= range.start && event.date <= range.end)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.ticker ?? "").localeCompare(b.ticker ?? ""),
    );

  return withMarketCaps(inRange, companies);
}

/**
 * Market cap comes from the live token feed and is attached only when the feed
 * is configured; otherwise the column stays empty rather than estimated.
 */
async function withMarketCaps(events: CalendarEvent[], companies: Equity[]) {
  const tickers = new Set(events.map((event) => event.ticker));
  const needed = companies.filter((equity) => tickers.has(equity.ticker));
  if (!needed.length) return events;
  try {
    const metadata = await jupiterMetadata(
      needed.flatMap((equity) => equity.representations),
    );
    const capByTicker = new Map<string, number>();
    for (const equity of needed) {
      for (const representation of equity.representations) {
        const cap = metadata.get(representation.mint)?.marketCapUsd;
        if (typeof cap === "number" && cap > 0) {
          capByTicker.set(equity.ticker, cap);
          break;
        }
      }
    }
    return events.map((event) => {
      const cap = event.ticker ? capByTicker.get(event.ticker) : undefined;
      return cap === undefined ? event : { ...event, marketCap: String(cap) };
    });
  } catch {
    return events;
  }
}

export function secCoverageSize() {
  return COVERAGE_LIMIT;
}
