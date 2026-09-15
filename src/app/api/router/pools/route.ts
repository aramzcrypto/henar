/**
 * Read-only view of the deployed pool registry for one representation:
 * verification state and detail, enabled flag, venue. Chain-derived facts
 * only; behind HENAR_ROUTER_QUOTES.
 */
import { NextResponse } from "next/server";
import { flagEnabled, poolsForRepresentation, routerRepresentationForMint } from "@henar/router-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!flagEnabled("routerQuotes")) return NextResponse.json({ error: "router is disabled" }, { status: 404 });
  const mint = new URL(request.url).searchParams.get("mint");
  const rep = mint ? routerRepresentationForMint(mint) : null;
  if (!rep) return NextResponse.json({ error: "unknown representation" }, { status: 404 });
  const pools = poolsForRepresentation(rep.id, { includeDisabled: true }).map((p) => ({
    venue: p.venue,
    address: p.address,
    poolType: p.poolType,
    enabled: p.enabled,
    disabledReason: p.disabledReason,
    verification: p.verification,
    onchainVerifiedAt: p.onchainVerifiedAt,
    verificationDetail: p.verificationDetail,
    observedTokenPrograms: p.observedTokenPrograms,
    tvlUsd: p.tvlUsd,
  }));
  return NextResponse.json({ representation: rep.id, pools }, { headers: { "Cache-Control": "no-store" } });
}
