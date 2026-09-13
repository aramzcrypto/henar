import { NextResponse } from "next/server";
import { equityForTicker } from "@/lib/equities/registry";
import { discoverEarn } from "@/lib/equities/earn";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const equity = equityForTicker((await params).ticker);
  if (!equity)
    return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  return NextResponse.json(
    { companyId: equity.id, ...(await discoverEarn(equity)) },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=30" } },
  );
}
