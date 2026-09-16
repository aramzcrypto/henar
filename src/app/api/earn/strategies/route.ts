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
import { depositAvailability, statsForStrategy } from "@/lib/strategies/pool-stats";
import { KAMINO } from "@/lib/strategies/adapters/kamino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!henarFlag("earnStrategies")) return NextResponse.json({ error: "Earn strategies are disabled." }, { status: 404 });
  const rpc = process.env.SOLANA_RPC_URL;
  try {
    const instances = await loadStrategyInstances({ connection: rpc ? rateLimitedConnection(rpc) : null });
    /* Pool statistics are read live per strategy: these pools run on their
       protocols today even though Henar's deposit path into them does not
       exist yet. */
    const stats = await Promise.all(
      instances.map((instance) =>
        statsForStrategy({ protocol: instance.market.protocol, address: instance.market.address, market: KAMINO.mainMarket }).catch(() => null),
      ),
    );
    return NextResponse.json(
      {
        definitions: STRATEGY_DEFINITIONS,
        instances,
        poolStats: Object.fromEntries(instances.map((instance, i) => [instance.id, stats[i]])),
        deposits: depositAvailability(),
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
