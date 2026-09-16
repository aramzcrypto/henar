/**
 * Pyth Pro history proxy. The symbol must be one Henar has mapped to a
 * verified asset, so the route cannot be used to relay arbitrary feeds.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { henarFlag } from "@/lib/feature-flags";
import { equityForTicker } from "@/lib/equities/registry";
import { pythCatalog } from "@/lib/pyth/catalog";
import { resolveCompanyFeeds } from "@/lib/pyth/feeds";
import { isResolution, pythHistory } from "@/lib/pyth/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const query = z.object({
  ticker: z.string().min(1).max(12),
  symbol: z.string().min(3).max(64),
  resolution: z.string().refine(isResolution, "unsupported resolution"),
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().positive(),
});

export async function GET(request: Request) {
  if (!henarFlag("pythPro")) return NextResponse.json({ error: "Pyth Pro is disabled." }, { status: 404 });
  const params = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return NextResponse.json({ error: "ticker, symbol, resolution, from and to are required." }, { status: 400 });
  const equity = equityForTicker(params.data.ticker);
  if (!equity) return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  try {
    const feeds = resolveCompanyFeeds(equity, await pythCatalog());
    const allowed = new Set([feeds.underlying?.symbol, ...Object.values(feeds.tokenized).map((m) => m.symbol)].filter(Boolean));
    if (!allowed.has(params.data.symbol)) return NextResponse.json({ error: "Symbol is not a verified feed for this company." }, { status: 400 });
    const history = await pythHistory({ symbol: params.data.symbol, resolution: params.data.resolution as never, from: params.data.from, to: params.data.to });
    return NextResponse.json(history, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120" } });
  } catch {
    return NextResponse.json({ error: "Pyth history is unavailable." }, { status: 503 });
  }
}
