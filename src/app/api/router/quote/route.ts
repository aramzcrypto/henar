/**
 * Henar Router comparison quote (Task 24) — behind HENAR_ROUTER_QUOTES and
 * HENAR_ROUTER_UI. Read-only: returns the router's guarded quote for display
 * next to the production Jupiter path. Never builds or submits; the live
 * Trade path is unchanged and remains the only execution route.
 */
import { NextResponse } from "next/server";
import { flagEnabled, routerRepresentationForMint, telemetrySinkFromEnv } from "@henar/router-core";
import { RouterApi } from "@henar/router-app";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter, raydiumCpmmAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";
import { rfqAdapter } from "@henar/venue-rfq";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

let api: RouterApi | null = null;
function routerApi() {
  if (!api) {
    const rpc = process.env.SOLANA_RPC_URL;
    api = new RouterApi({
      adapters: [jupiterAdapter, raydiumAdapter, raydiumCpmmAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter, rfqAdapter],
      connection: rpc ? rateLimitedConnection(rpc) : null,
      health: null,
      telemetry: telemetrySinkFromEnv(),
    });
  }
  return api;
}

export async function POST(request: Request) {
  if (!flagEnabled("routerQuotes") || process.env.HENAR_ROUTER_UI !== "1")
    return NextResponse.json({ error: "router comparison is disabled" }, { status: 404 });
  let body: { mint?: string; side?: "buy" | "sell"; amount?: string; deadlineMs?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const rep = body.mint ? routerRepresentationForMint(body.mint) : null;
  if (!rep || !body.side || !body.amount) return NextResponse.json({ error: "mint, side and amount are required" }, { status: 400 });
  /* A caller may ask for a longer venue deadline for diagnosis. Clamped, and
     never the default: production times out Raydium and Orca at exactly
     6000ms on calls that take under two seconds locally, and without being
     able to let one run longer there is no way to learn what they actually
     cost in that environment. */
  const deadlineMs = Math.min(Math.max(Number(body.deadlineMs) || 0, 0), 25_000) || undefined;
  const r = await routerApi().quote({ representationId: rep.id, side: body.side, amount: body.amount, deadlineMs });
  return NextResponse.json(r.body, { status: r.status });
}
