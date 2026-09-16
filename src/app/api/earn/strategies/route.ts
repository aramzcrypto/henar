/**
 * Strategy monitoring. Read-only: there is no deposit, withdraw or execute
 * endpoint for these strategies, by design.
 */
import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { loadStrategyInstances } from "@/lib/strategies/engine";
import { STRATEGY_DEFINITIONS } from "@/lib/strategies/definitions";
import { marketRegistryReport } from "@/lib/strategies/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!henarFlag("earnStrategies")) return NextResponse.json({ error: "Earn strategies are disabled." }, { status: 404 });
  const rpc = process.env.SOLANA_RPC_URL;
  try {
    const instances = await loadStrategyInstances({ connection: rpc ? rateLimitedConnection(rpc) : null });
    return NextResponse.json(
      {
        definitions: STRATEGY_DEFINITIONS,
        instances,
        markets: marketRegistryReport({ requireLimitOrders: false }),
        publicDepositsEnabled: henarFlag("publicStrategyDeposits"),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch {
    return NextResponse.json({ error: "Strategy state is unavailable." }, { status: 503 });
  }
}
