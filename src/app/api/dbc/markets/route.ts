/**
 * DBC monitoring (DBC-18): every registry DBC market with live lifecycle,
 * reserves, fees and successor, read through the same state code the router
 * quotes with. Behind HENAR_DBC_STUDIO. Read-only.
 */
import { NextResponse } from "next/server";
import { flagEnabled } from "@henar/router-core";
import { monitorRegistryDbcMarkets } from "@henar/dbc-studio";
import { rateLimitedConnection } from "@/lib/rpc-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

let cached: { until: number; body: unknown } | null = null;

export async function GET() {
  if (!flagEnabled("dbcStudio")) return NextResponse.json({ error: "DBC Studio is disabled" }, { status: 404 });
  if (cached && cached.until > Date.now()) return NextResponse.json(cached.body, { headers: { "Cache-Control": "no-store" } });
  const rpc = process.env.SOLANA_RPC_URL;
  const connection = rpc ? rateLimitedConnection(rpc) : null;
  const markets = await monitorRegistryDbcMarkets(connection);
  const body = { markets, readAt: new Date().toISOString(), rpcConfigured: Boolean(rpc) };
  cached = { until: Date.now() + 20_000, body };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
