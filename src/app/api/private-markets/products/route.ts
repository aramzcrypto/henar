/**
 * The selector's view of private-market products: identity, provider,
 * company, mint and (when the chain has been read) decimals. No quotes.
 */
import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { loadPrivateMarkets } from "@/lib/private-markets/registry";
import { PRIVATE_PROVIDER_LABELS } from "@/lib/private-markets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SelectorPrivateProduct = {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  provider: string;
  providerId: "prestocks" | "tessera";
  companySlug: string;
  companyName: string;
  logo: string | null;
  decimals: number | null;
  transferFeeBps: number | null;
  scaledUiMultiplier: string | null;
  executionReference: { price: string | null; quotedAt: string | null } | null;
  markPrice: number | null;
};

export async function GET() {
  if (!henarFlag("preIpoMarkets")) return NextResponse.json({ error: "Pre-IPO markets are disabled." }, { status: 404 });
  try {
    const markets = await loadPrivateMarkets({ onchain: true, execution: true });
    const names = new Map(markets.companies.map((c) => [c.id, c]));
    const products: SelectorPrivateProduct[] = markets.products.map((p) => ({
      id: p.id,
      mint: p.mint,
      symbol: p.symbol,
      name: p.name,
      provider: PRIVATE_PROVIDER_LABELS[p.provider],
      providerId: p.provider,
      companySlug: names.get(p.companyId)?.slug ?? p.companyId,
      companyName: names.get(p.companyId)?.name ?? p.name,
      logo: p.image,
      decimals: p.onchain?.decimals ?? null,
      transferFeeBps: p.onchain?.transferFeeBps ?? null,
      scaledUiMultiplier: p.onchain?.scaledUiMultiplier ?? null,
      executionReference: p.execution ? { price: p.execution.referenceUiPrice, quotedAt: p.execution.quotedAt } : null,
      markPrice: p.mark?.price ?? null,
    }));
    return NextResponse.json({ products, sources: markets.sources, generatedAt: markets.generatedAt }, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Pre-IPO products are unavailable." }, { status: 503 });
  }
}
