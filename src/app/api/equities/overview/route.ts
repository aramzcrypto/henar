import { NextResponse } from "next/server";
import { marketsOverview } from "@/lib/equities/jupiter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await marketsOverview(), {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Market overview is unavailable." },
      { status: 503 },
    );
  }
}
