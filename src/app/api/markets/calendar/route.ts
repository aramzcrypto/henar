import { NextResponse } from "next/server";
import { z } from "zod";
import { loadCalendar } from "@/lib/equities/calendar";

export const dynamic = "force-dynamic";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const querySchema = z
  .object({ start: day, end: day })
  .refine((value) => value.start <= value.end, "Range is inverted")
  .refine((value) => {
    const span =
      (Date.parse(`${value.end}T00:00:00Z`) -
        Date.parse(`${value.start}T00:00:00Z`)) /
      86_400_000;
    return span <= 62;
  }, "Range is limited to 62 days");

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = querySchema.parse(Object.fromEntries(url.searchParams));
    const calendar = await loadCalendar(range);
    return NextResponse.json(calendar, {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load the calendar." },
      { status: 400 },
    );
  }
}
