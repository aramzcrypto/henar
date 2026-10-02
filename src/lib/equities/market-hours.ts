import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
const holidaySchema = z.array(
  z.object({
    market: z.string(),
    date: z.string(),
    timezone: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
  }),
);
type Holiday = z.infer<typeof holidaySchema>[number];
const cached = createReadCache<Holiday[]>(3_600_000, 1);
export type TraditionalStatus = {
  status: "open" | "closed" | "unknown";
  label: string;
  asOf: string;
};
/**
 * Whether the underlying share can be traded or hedged right now.
 *
 * "Closed" is not one state, and treating it as one hides the risk that
 * matters. On a weekday night the share still trades on overnight venues, so a
 * market maker holding a tokenised position can offset it and quotes stay near
 * their weekday level. From 20:00 ET on Friday until 20:00 on Sunday nothing
 * trades or clears it: a maker who buys on Friday night cannot hedge it or
 * even price it until Sunday, so it widens the quote or steps back. Arrakis
 * Research measured one issuer's quote going from 13.3 to 23.1 bps across that
 * boundary while centralised books nearly tripled, and Aave's Equities Hub
 * freezes its price feeds over the same window to keep weekend moves from
 * liquidating loans.
 *
 * This matters to Henar more than to a single-issuer venue: 63% of Solana
 * tokenised-equity volume trades while US exchanges are closed, and different
 * issuers hold their spreads differently through it.
 *
 * Pure, so the boundaries are testable without a clock or a network.
 */
export type UnderlyingPhase = "regular" | "extended" | "overnight" | "weekend";

export type UnderlyingWindow = {
  phase: UnderlyingPhase;
  /** False only when no venue trades or clears the share: the weekend gap. */
  hedgeable: boolean;
  label: string;
  asOf: string;
};

/** Minutes past midnight in New York, with the weekday, for one instant. */
function newYorkParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function underlyingWindow(now: Date, holidays: Holiday[] | null): UnderlyingWindow {
  const { weekday, minutes } = newYorkParts(now);
  const asOf = now.toISOString();
  const regular = regularSessionStatus(now, holidays).status === "open";
  if (regular) return { phase: "regular", hedgeable: true, label: "US regular session", asOf };

  // The gap: Friday 20:00 ET through Sunday 20:00 ET.
  const fridayNight = weekday === "Fri" && minutes >= 1_200;
  const saturday = weekday === "Sat";
  const sundayBeforeOpen = weekday === "Sun" && minutes < 1_200;
  if (fridayNight || saturday || sundayBeforeOpen)
    return {
      phase: "weekend",
      hedgeable: false,
      label: "US market and overnight venues closed until Sunday 20:00 ET",
      asOf,
    };

  // Pre-market and after-hours on a weekday: 04:00–09:30 and 16:00–20:00 ET.
  if (minutes >= 240 && minutes < 1_200)
    return { phase: "extended", hedgeable: true, label: "US extended hours", asOf };

  // Weeknights, including Sunday evening: overnight venues trade the share.
  return { phase: "overnight", hedgeable: true, label: "US overnight session", asOf };
}

export function regularSessionStatus(
  now: Date,
  holidays: Holiday[] | null,
): TraditionalStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const base = { label: "US regular session", asOf: now.toISOString() };
  if (
    ["Sat", "Sun"].includes(get("weekday")) ||
    minutes < 570 ||
    minutes >= 960
  )
    return { ...base, status: "closed" };
  if (!holidays) return { ...base, status: "unknown" };
  const time = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const closed = holidays.some(
    (h) =>
      h.date === date &&
      h.timezone === "America/New_York" &&
      h.market === "US_EQUITIES" &&
      (!h.startTime ||
        !h.endTime ||
        (minutes >= time(h.startTime) && minutes < time(h.endTime))),
  );
  return { ...base, status: closed ? "closed" : "open" };
}
export async function traditionalMarketStatus(): Promise<TraditionalStatus> {
  try {
    const holidays = await cached("us", async () => {
      const response = await fetch(
        "https://api.backpack.exchange/api/v1/market-holidays",
        { cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
      if (!response.ok) throw new Error("Calendar unavailable");
      return holidaySchema.parse(await response.json());
    });
    return regularSessionStatus(new Date(), holidays);
  } catch {
    return regularSessionStatus(new Date(), null);
  }
}

/**
 * `underlyingWindow` with the holiday calendar fetched and cached.
 *
 * Shares the cache with `traditionalMarketStatus`, so adding this to a quote
 * costs no extra request. Without the calendar the weekday and weekend
 * boundaries still hold; only a holiday inside a regular session is missed.
 */
export async function underlyingMarketWindow(): Promise<UnderlyingWindow> {
  try {
    const holidays = await cached("us", async () => {
      const response = await fetch(
        "https://api.backpack.exchange/api/v1/market-holidays",
        { cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
      if (!response.ok) throw new Error("Calendar unavailable");
      return holidaySchema.parse(await response.json());
    });
    return underlyingWindow(new Date(), holidays);
  } catch {
    return underlyingWindow(new Date(), null);
  }
}
