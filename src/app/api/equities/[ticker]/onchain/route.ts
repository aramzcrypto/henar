import { NextResponse } from "next/server";
import { equityForTicker } from "@/lib/equities/registry";
import { companyComparison } from "@/lib/equities/comparison";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const equity = equityForTicker((await params).ticker);
  if (!equity)
    return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  try {
    return NextResponse.json(await companyComparison(equity), {
      headers: {
        "Cache-Control":
          /* One miss here is ~48 aggregator calls plus RPC reads, and the
             company page refreshes on a 30s cadence, so a 10s shared window
             left most of that cadence hitting the origin. Widening it to 15s
             with a 30s stale window halves origin hits without changing what
             the page shows or how often it asks. */
          "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Live onchain comparison is unavailable." },
      { status: 503 },
    );
  }
}
