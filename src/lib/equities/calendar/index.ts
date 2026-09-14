import { unstable_cache } from "next/cache";
import { secCoverageSize, secEarningsEvents } from "./sec-adapter";
import {
  VENDOR_NAME,
  vendorConfigured,
  vendorEarningsEvents,
  vendorMacroEvents,
} from "./vendor-adapter";
import type {
  CalendarEvent,
  CalendarFeed,
  CalendarRange,
  CalendarResponse,
} from "./types";

export * from "./types";

function notConnected(note: string): CalendarFeed {
  return { status: "not-connected", events: [], provider: null, asOf: null, note };
}

function available(events: CalendarEvent[], provider: string): CalendarFeed {
  return {
    status: "available",
    events,
    provider,
    asOf: new Date().toISOString(),
    note: null,
  };
}

function mergeById(groups: CalendarEvent[][]) {
  const merged = new Map<string, CalendarEvent>();
  for (const group of groups) {
    for (const event of group) {
      // A vendor record for the same company and day supersedes the SEC one
      // because it carries estimates and reporting time.
      const key = `${event.type}:${event.ticker ?? event.eventName}:${event.date}`;
      const existing = merged.get(key);
      if (!existing || event.source === VENDOR_NAME) merged.set(key, event);
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "").localeCompare(b.time ?? "") ||
      (a.ticker ?? a.eventName ?? "").localeCompare(b.ticker ?? b.eventName ?? ""),
  );
}

async function buildCalendar(range: CalendarRange): Promise<CalendarResponse> {
  const useVendor = vendorConfigured();
  const [secEarnings, vendorEarnings, macro] = await Promise.all([
    secEarningsEvents(range).catch(() => []),
    useVendor ? vendorEarningsEvents(range).catch(() => []) : Promise.resolve([]),
    useVendor ? vendorMacroEvents(range).catch(() => []) : Promise.resolve([]),
  ]);

  // The SEC feed is connected by definition: it needs no credentials. An empty
  // range means nothing was filed then, which is different from no provider.
  const earningsEvents = mergeById([secEarnings, vendorEarnings]);
  const earnings = available(
    earningsEvents,
    useVendor ? `${VENDOR_NAME} · SEC EDGAR` : "SEC EDGAR",
  );
  if (!useVendor) {
    earnings.note = `Showing results filed with SEC EDGAR for the ${secCoverageSize()} most-represented companies. Forward-looking dates and analyst estimates need a calendar provider.`;
  }

  return {
    range,
    earnings,
    macro: macro.length
      ? available(macro, VENDOR_NAME)
      : notConnected(
          useVendor
            ? "The macro provider returned no events for this range."
            : "Macro events require a calendar provider. Set CALENDAR_API_KEY to enable them.",
        ),
  };
}

const cachedCalendar = unstable_cache(buildCalendar, ["henar-calendar-v1"], {
  revalidate: 1_800,
});

export async function loadCalendar(range: CalendarRange) {
  return cachedCalendar(range);
}

/** Inclusive month bounds for the month containing the given day. */
export function monthRange(date: Date): CalendarRange {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  );
  return { start: isoDay(start), end: isoDay(end) };
}

export function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Grid bounds for a month view, padded to whole Monday-start weeks. */
export function monthGridRange(date: Date): CalendarRange {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  );
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + ((7 - ((last.getUTCDay() + 6) % 7) - 1) % 7));
  return { start: isoDay(start), end: isoDay(end) };
}

export function weekRange(date: Date): CalendarRange {
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: isoDay(start), end: isoDay(end) };
}

export function dayRange(date: Date): CalendarRange {
  return { start: isoDay(date), end: isoDay(date) };
}
