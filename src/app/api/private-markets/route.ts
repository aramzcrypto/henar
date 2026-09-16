/**
 * Pre-IPO markets: provider catalogs, on-chain state and the executable
 * reference per product. Provider outages are reported per source, never
 * papered over.
 */
import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { loadPrivateMarkets } from "@/lib/private-markets/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!henarFlag("preIpoMarkets")) return NextResponse.json({ error: "Pre-IPO markets are disabled." }, { status: 404 });
  try {
    return NextResponse.json(await loadPrivateMarkets({ onchain: true, execution: true }), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "Pre-IPO markets are unavailable." }, { status: 503 });
  }
}
