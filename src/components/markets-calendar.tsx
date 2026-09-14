"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import { MarketsTabs } from "./markets-tabs";
import {
  CALENDAR_COUNTRIES,
  COUNTRY_FLAGS,
  COUNTRY_LABELS,
  type CalendarCountry,
  type CalendarEvent,
  type CalendarResponse,
} from "@/lib/equities/calendar/types";

type Mode = "month" | "week" | "day";
type Scope = "all" | "watchlist" | "holdings";

// Sunday-start weeks, the convention used by US financial calendars.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_CELL_LIMIT = 5;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(value: string, amount: number) {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDay(date);
}

function addMonths(value: string, amount: number) {
  const date = parseDay(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return isoDay(date);
}

function startOfWeek(value: string) {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return isoDay(date);
}

/** Whole Sunday-start weeks covering the month that contains `value`. */
function monthGrid(value: string) {
  const date = parseDay(value);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const cursor = parseDay(startOfWeek(isoDay(first)));
  const days: string[] = [];
  for (let index = 0; index < 42; index++) {
    days.push(isoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const month = date.getUTCMonth();
  while (
    days.length > 35 &&
    parseDay(days[days.length - 7]).getUTCMonth() !== month
  )
    days.splice(days.length - 7, 7);
  return days;
}

function formatNumber(value: string | null) {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCap(value: string | null) {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (parsed >= 1_000_000_000_000)
    return `$${(parsed / 1_000_000_000_000).toFixed(2)}T`;
  if (parsed >= 1_000_000_000) return `$${(parsed / 1_000_000_000).toFixed(2)}B`;
  if (parsed >= 1_000_000) return `$${(parsed / 1_000_000).toFixed(2)}M`;
  return `$${parsed.toFixed(0)}`;
}

function formatEps(value: string | null) {
  if (value === null) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return `${parsed < 0 ? "-" : ""}$${Math.abs(parsed).toFixed(2)}`;
}

const TIMING_LABELS: Record<string, string> = {
  "before-open": "Before open",
  "after-close": "After close",
  during: "During session",
};

function timingLabel(event: CalendarEvent) {
  if (event.timing) return TIMING_LABELS[event.timing];
  return event.time ? `${event.time} UTC` : "—";
}

function FeedNote({ label, note }: { label: string; note: string }) {
  return (
    <p className="calendar-note">
      <Info size={13} />
      <span>
        <strong>{label}</strong> {note}
      </span>
    </p>
  );
}

function MonthView({
  anchor,
  today,
  byDay,
  onPickDay,
}: {
  anchor: string;
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  onPickDay: (day: string) => void;
}) {
  const days = monthGrid(anchor);
  const month = parseDay(anchor).getUTCMonth();
  return (
    <div className="calendar-month">
      <div className="calendar-month-head">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-month-grid">
        {days.map((day) => {
          const events = byDay.get(day) ?? [];
          const visible = events.slice(0, MONTH_CELL_LIMIT);
          const outside = parseDay(day).getUTCMonth() !== month;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              className={[
                "calendar-day",
                outside ? "calendar-day-outside" : "",
                day === today ? "calendar-day-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="calendar-day-head">
                <span className="calendar-day-number">
                  {Number(day.slice(8))}
                </span>
              </span>
              <span className="calendar-day-items">
                {visible.map((event) =>
                  event.type === "earnings" ? (
                    <Link
                      key={event.id}
                      className="calendar-chip calendar-chip-earnings"
                      href={`/markets/${event.ticker}`}
                      title={`${event.companyName ?? ""} — ${event.eventName ?? "Earnings"}`}
                    >
                      <EquityLogo
                        logo={event.companyLogo}
                        ticker={event.ticker ?? "?"}
                        size={16}
                      />
                      <b>{event.ticker}</b>
                    </Link>
                  ) : (
                    <span
                      key={event.id}
                      className="calendar-chip calendar-chip-macro"
                      title={event.eventName ?? ""}
                    >
                      <i aria-hidden>{COUNTRY_FLAGS[event.country]}</i>
                      <b>{event.eventName}</b>
                    </span>
                  ),
                )}
                {events.length > visible.length ? (
                  <span className="calendar-more">
                    +{events.length - visible.length} more
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  anchor,
  today,
  byDay,
  onPickDay,
}: {
  anchor: string;
  today: string;
  byDay: Map<string, CalendarEvent[]>;
  onPickDay: (day: string) => void;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <div className="calendar-week">
      {days.map((day) => {
        const events = byDay.get(day) ?? [];
        return (
          <section
            key={day}
            className={`calendar-week-day${day === today ? " calendar-day-today" : ""}`}
          >
            <header>
              <button type="button" onClick={() => onPickDay(day)}>
                <span>{WEEKDAYS[parseDay(day).getUTCDay()]}</span>
                <b>{Number(day.slice(8))}</b>
              </button>
            </header>
            <div className="calendar-week-items">
              {events.length === 0 ? (
                <span className="calendar-empty-day">No events</span>
              ) : (
                events.map((event) =>
                  event.type === "earnings" ? (
                    <Link
                      key={event.id}
                      href={`/markets/${event.ticker}`}
                      className="calendar-week-earnings"
                    >
                      <EquityLogo
                        logo={event.companyLogo}
                        ticker={event.ticker ?? "?"}
                        size={20}
                      />
                      <span>
                        <b>{event.ticker}</b>
                        <i>{event.companyName}</i>
                      </span>
                    </Link>
                  ) : (
                    <div key={event.id} className="calendar-week-macro">
                      <span aria-hidden className="calendar-week-flag">
                        {COUNTRY_FLAGS[event.country]}
                      </span>
                      <span>
                        <b>{event.eventName}</b>
                        <i>{event.time ?? "Time unavailable"}</i>
                      </span>
                    </div>
                  ),
                )
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayView({
  anchor,
  events,
  showEarnings,
  showMacro,
}: {
  anchor: string;
  events: CalendarEvent[];
  showEarnings: boolean;
  showMacro: boolean;
}) {
  const earnings = events.filter((event) => event.type === "earnings");
  const macro = events.filter((event) => event.type === "macro");
  const date = parseDay(anchor);
  return (
    <div className="calendar-day-view">
      <h2 className="calendar-day-title">
        {WEEKDAY_NAMES[date.getUTCDay()]}, {MONTHS[date.getUTCMonth()]}{" "}
        {date.getUTCDate()}, {date.getUTCFullYear()}
      </h2>

      {showEarnings ? (
        <section className="calendar-table-block">
          <h3>
            <i className="legend-earnings" /> Earnings <b>{earnings.length}</b>
          </h3>
          {earnings.length === 0 ? (
            <p className="calendar-empty">
              No verified earnings records for this day.
            </p>
          ) : (
            <div className="calendar-table-scroll">
              <table className="calendar-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Timing</th>
                    <th className="num">Est. EPS</th>
                    <th className="num">Actual EPS</th>
                    <th className="num">Surprise</th>
                    <th className="num">Market cap</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link
                          href={`/markets/${event.ticker}`}
                          className="calendar-company"
                        >
                          <EquityLogo
                            logo={event.companyLogo}
                            ticker={event.ticker ?? "?"}
                            size={26}
                          />
                          <span>
                            <b>{event.ticker}</b>
                            <i>{event.companyName}</i>
                          </span>
                        </Link>
                      </td>
                      <td>{timingLabel(event)}</td>
                      <td className="num">{formatEps(event.estimatedEps)}</td>
                      <td className="num">{formatEps(event.actualEps)}</td>
                      <td
                        className={`num${
                          event.surprise
                            ? Number(event.surprise) >= 0
                              ? " positive"
                              : " negative"
                            : ""
                        }`}
                      >
                        {event.surprise
                          ? `${Number(event.surprise).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="num">{formatCap(event.marketCap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {showMacro ? (
        <section className="calendar-table-block">
          <h3>
            <i className="legend-macro" /> Macro <b>{macro.length}</b>
          </h3>
          {macro.length === 0 ? (
            <p className="calendar-empty">No macro events for this day.</p>
          ) : (
            <div className="calendar-table-scroll">
              <table className="calendar-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Time (UTC)</th>
                    <th className="num">Previous</th>
                    <th className="num">Estimate</th>
                    <th className="num">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {macro.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <span className="calendar-country">
                          <i aria-hidden>{COUNTRY_FLAGS[event.country]}</i>
                          <span>
                            <b>{event.eventName}</b>
                            <em>{COUNTRY_LABELS[event.country]}</em>
                          </span>
                        </span>
                      </td>
                      <td>{event.time ?? "—"}</td>
                      <td className="num">{formatNumber(event.previous)}</td>
                      <td className="num">{formatNumber(event.estimate)}</td>
                      <td className="num">{formatNumber(event.actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function MarketsCalendar({
  initial,
  today,
}: {
  initial: CalendarResponse;
  today: string;
}) {
  const [mode, setMode] = useState<Mode>("month");
  // The server range is padded to whole weeks and can start in the previous
  // month, so the anchor tracks the real day instead.
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [showEarnings, setShowEarnings] = useState(true);
  const [showMacro, setShowMacro] = useState(true);
  const [scope, setScope] = useState<Scope>("all");
  const [countries, setCountries] = useState<CalendarCountry[]>([]);

  const range = useMemo(() => {
    if (mode === "day") return { start: anchor, end: anchor };
    if (mode === "week") {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 6) };
    }
    const days = monthGrid(anchor);
    return { start: days[0], end: days[days.length - 1] };
  }, [mode, anchor]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/markets/calendar?start=${range.start}&end=${range.end}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setData)
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range.start, range.end]);

  const events = useMemo(() => {
    const combined = [
      ...(showEarnings ? data.earnings.events : []),
      ...(showMacro ? data.macro.events : []),
    ];
    // Country selection filters macro releases. Earnings coverage is US filings,
    // so an empty selection means no restriction at all.
    return combined.filter(
      (event) =>
        event.type === "earnings" ||
        countries.length === 0 ||
        countries.includes(event.country),
    );
  }, [data, showEarnings, showMacro, countries]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    }
    return map;
  }, [events]);

  const step = useCallback(
    (direction: -1 | 1) => {
      setAnchor((current) =>
        mode === "month"
          ? addMonths(current, direction)
          : addDays(current, direction * (mode === "week" ? 7 : 1)),
      );
    },
    [mode],
  );

  const heading = useMemo(() => {
    const date = parseDay(anchor);
    if (mode === "month")
      return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    if (mode === "week") {
      const start = startOfWeek(anchor);
      const from = parseDay(start);
      const to = parseDay(addDays(start, 6));
      return `${MONTHS[from.getUTCMonth()].slice(0, 3)} ${from.getUTCDate()} – ${MONTHS[
        to.getUTCMonth()
      ].slice(0, 3)} ${to.getUTCDate()}, ${to.getUTCFullYear()}`;
    }
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
  }, [mode, anchor]);

  const openDay = useCallback((day: string) => {
    setAnchor(day);
    setMode("day");
  }, []);

  const toggleCountry = useCallback((code: CalendarCountry) => {
    setCountries((current) =>
      current.includes(code)
        ? current.filter((value) => value !== code)
        : [...current, code],
    );
  }, []);

  return (
    <section className="markets-shell">
      <div className="markets-heading markets-heading-compact">
        <div>
          <h1>Markets</h1>
          <span>Earnings and macro events for verified companies</span>
        </div>
        <MarketsTabs active="calendar" />
      </div>

      <div className="calendar-layout">
        <div className="calendar-main">
          <div className="calendar-toolbar">
            <div className="calendar-nav">
              <button
                type="button"
                aria-label="Previous"
                onClick={() => step(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button type="button" aria-label="Next" onClick={() => step(1)}>
                <ChevronRight size={16} />
              </button>
              <h2>{heading}</h2>
              <button
                type="button"
                className="calendar-today"
                onClick={() => setAnchor(today)}
              >
                Today
              </button>
              {loading ? (
                <span className="calendar-loading">Updating…</span>
              ) : null}
            </div>
            <div className="calendar-modes" role="tablist">
              {(["month", "week", "day"] as Mode[]).map((value) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={mode === value}
                  className={mode === value ? "active" : ""}
                  onClick={() => setMode(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {showEarnings && data.earnings.note ? (
            <FeedNote label="Earnings:" note={data.earnings.note} />
          ) : null}
          {showMacro && data.macro.status === "not-connected" ? (
            <FeedNote label="Macro:" note={data.macro.note ?? ""} />
          ) : null}

          {mode === "month" ? (
            <MonthView
              anchor={anchor}
              today={today}
              byDay={byDay}
              onPickDay={openDay}
            />
          ) : mode === "week" ? (
            <WeekView
              anchor={anchor}
              today={today}
              byDay={byDay}
              onPickDay={openDay}
            />
          ) : (
            <DayView
              anchor={anchor}
              events={byDay.get(anchor) ?? []}
              showEarnings={showEarnings}
              showMacro={showMacro}
            />
          )}

          <p className="calendar-sources">
            {data.earnings.provider
              ? `Earnings: ${data.earnings.provider}. `
              : ""}
            {data.macro.provider ? `Macro: ${data.macro.provider}. ` : ""}
            Henar shows only events published by a verified source.
          </p>
        </div>

        <aside className="calendar-sidebar">
          <section>
            <h3>Event type</h3>
            <button
              type="button"
              className={`calendar-pill${showEarnings ? " active" : ""}`}
              aria-pressed={showEarnings}
              onClick={() => setShowEarnings((value) => !value)}
            >
              <i className="legend-earnings" /> Earnings
            </button>
            <button
              type="button"
              className={`calendar-pill${showMacro ? " active" : ""}`}
              aria-pressed={showMacro}
              onClick={() => setShowMacro((value) => !value)}
            >
              <i className="legend-macro" /> Macro
            </button>
          </section>

          <section>
            <h3>Filter by</h3>
            {(
              [
                ["all", "All", false],
                ["watchlist", "Watchlist", true],
                ["holdings", "Holdings", true],
              ] as [Scope, string, boolean][]
            ).map(([value, label, soon]) => (
              <label
                key={value}
                className={`calendar-check${soon ? " calendar-check-disabled" : ""}`}
              >
                <input
                  type="radio"
                  name="calendar-scope"
                  checked={scope === value}
                  disabled={soon}
                  onChange={() => setScope(value)}
                />
                <span>{label}</span>
                {soon ? <em>Coming soon</em> : null}
              </label>
            ))}
          </section>

          <section>
            <h3>Country</h3>
            {CALENDAR_COUNTRIES.map((code) => (
              <label key={code} className="calendar-check">
                <input
                  type="checkbox"
                  checked={countries.includes(code)}
                  onChange={() => toggleCountry(code)}
                />
                <span>
                  <i aria-hidden>{COUNTRY_FLAGS[code]}</i> {code}
                </span>
              </label>
            ))}
            <p className="calendar-hint">Applies to macro releases.</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
