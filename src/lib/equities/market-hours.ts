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
