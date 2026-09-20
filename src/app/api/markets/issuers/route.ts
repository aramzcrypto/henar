import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { issuerComparison } from "@/lib/issuers/registry";

export const dynamic = "force-dynamic";

/**
 * The issuer comparison behind the Markets overview: volume and pooled
 * liquidity per issuer, each beside the mints it was measured over.
 *
 * Reads the shared catalog-wide market pass, so it costs nothing beyond what
 * ranked market views already pay for.
 */
export async function GET() {
  if (!henarFlag("issuerIntelligence"))
    return NextResponse.json({ error: "Issuer intelligence is switched off." }, { status: 404 });
  try {
    return NextResponse.json(await issuerComparison(), {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "The issuer comparison is unavailable." }, { status: 503 });
  }
}
