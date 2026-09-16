/**
 * One private company with every exposure product fully enriched: provider
 * data, on-chain state, depth ladder and verified pools.
 */
import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { companyForSlug } from "@/lib/private-markets/companies";
import { loadPrivateMarkets } from "@/lib/private-markets/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ company: string }> }) {
  if (!henarFlag("preIpoMarkets")) return NextResponse.json({ error: "Pre-IPO markets are disabled." }, { status: 404 });
  const slug = (await params).company;
  try {
    const markets = await loadPrivateMarkets({ onchain: true, execution: true, liquidity: true });
    const company = companyForSlug(markets.companies, slug);
    if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
    return NextResponse.json({ company, sources: markets.sources, generatedAt: markets.generatedAt }, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "Pre-IPO company data is unavailable." }, { status: 503 });
  }
}
