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
          "public, max-age=0, s-maxage=10, stale-while-revalidate=5",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Live onchain comparison is unavailable." },
      { status: 503 },
    );
  }
}
