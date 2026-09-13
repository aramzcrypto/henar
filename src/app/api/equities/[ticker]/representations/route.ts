import { NextResponse } from "next/server";
import { equityForTicker } from "@/lib/equities/registry";
import { verifiedRepresentations } from "@/lib/equities/onchain";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const equity = equityForTicker((await params).ticker);
  if (!equity)
    return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  try {
    return NextResponse.json(
      {
        equity: equity.ticker,
        representations: await verifiedRepresentations(equity),
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json(
      { equity: equity.ticker, representations: equity.representations },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=15" } },
    );
  }
}
