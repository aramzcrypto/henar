import { NextResponse } from "next/server";
import { equityForTicker } from "@/lib/equities/registry";
import { corporateActionsFor } from "@/lib/equities/corporate-actions";
import { loadResearchForEquity } from "@/lib/equities/research";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const equity = equityForTicker((await params).ticker);
  if (!equity)
    return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  const research = await loadResearchForEquity(equity);
  return NextResponse.json(
    {
      ...equity,
      corporateActions: corporateActionsFor(equity.id),
      research,
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } },
  );
}
