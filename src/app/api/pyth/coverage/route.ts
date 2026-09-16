/**
 * Pyth Pro entitlement and coverage, measured at runtime. Carries no key and
 * no raw upstream error bodies beyond a short detail.
 */
import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { pythCoverage } from "@/lib/pyth/coverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!henarFlag("pythPro")) return NextResponse.json({ error: "Pyth Pro is disabled." }, { status: 404 });
  try {
    return NextResponse.json(await pythCoverage(), {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ error: "Pyth coverage is unavailable." }, { status: 503 });
  }
}
