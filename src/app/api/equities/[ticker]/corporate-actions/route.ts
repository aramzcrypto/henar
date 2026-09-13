import { NextResponse } from "next/server";
import { corporateActionsFor } from "@/lib/equities/corporate-actions";
import { equityForTicker } from "@/lib/equities/registry";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const equity = equityForTicker((await params).ticker);
  if (!equity)
    return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  return NextResponse.json(
    { equity: equity.ticker, actions: corporateActionsFor(equity.id) },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } },
  );
}
