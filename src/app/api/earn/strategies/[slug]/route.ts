import { NextResponse } from "next/server";
import { henarFlag } from "@/lib/feature-flags";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { definitionBySlug } from "@/lib/strategies/definitions";
import { strategyInstanceBySlug } from "@/lib/strategies/engine";
import { marketRegistryReport } from "@/lib/strategies/markets";
import { evaluateStrategy } from "@/lib/strategies/runner";
import { depositAvailability, statsForStrategy } from "@/lib/strategies/pool-stats";
import { KAMINO } from "@/lib/strategies/adapters/kamino";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!henarFlag("earnStrategies")) return NextResponse.json({ error: "Earn strategies are disabled." }, { status: 404 });
  const slug = (await params).slug;
  const definition = definitionBySlug(slug);
  if (!definition) return NextResponse.json({ error: "Strategy not found." }, { status: 404 });
  const rpc = process.env.SOLANA_RPC_URL;
  try {
    const instance = await strategyInstanceBySlug(slug, { connection: rpc ? rateLimitedConnection(rpc) : null });
    if (!instance) return NextResponse.json({ error: "Strategy not found." }, { status: 404 });
    /* The runner's verdict is diagnostic here: it says what the strategy
       would do and what is stopping it. It never executes from a request. */
    const evaluation = await evaluateStrategy(instance).catch(() => null);
    const poolStats = await statsForStrategy({ protocol: instance.market.protocol, address: instance.market.address, market: KAMINO.mainMarket }).catch(() => null);
    return NextResponse.json(
      {
        definition,
        instance,
        poolStats,
        deposits: depositAvailability(),
        proposals: evaluation?.proposals ?? [],
        breakers: evaluation?.breakers ?? [],
        markets: marketRegistryReport({ requireLimitOrders: definition.strategyType === "SMART_ACCUMULATE" }),
        publicDepositsEnabled: henarFlag("publicStrategyDeposits"),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch {
    return NextResponse.json({ error: "Strategy state is unavailable." }, { status: 503 });
  }
}
