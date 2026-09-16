import { NextResponse } from "next/server";
import { equityForTicker } from "@/lib/equities/registry";
import { henarFlag } from "@/lib/feature-flags";
import { companyPyth } from "@/lib/pyth/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  if (!henarFlag("pythPro")) return NextResponse.json({ error: "Pyth Pro is disabled." }, { status: 404 });
  const equity = equityForTicker((await params).ticker);
  if (!equity) return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  try {
    return NextResponse.json(await companyPyth(equity), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=2, stale-while-revalidate=5" },
    });
  } catch {
    return NextResponse.json({ error: "Pyth market data is unavailable." }, { status: 503 });
  }
}
