import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { EarnPage } from "@/components/earn-page";
import { henarFlag } from "@/lib/feature-flags";
import { STRATEGY_DEFINITIONS } from "@/lib/strategies/definitions";
import { loadStrategyInstances } from "@/lib/strategies/engine";
import { KAMINO } from "@/lib/strategies/adapters/kamino";
import { depositAvailability, statsForStrategy, type PoolStats } from "@/lib/strategies/pool-stats";
import { rateLimitedConnection } from "@/lib/rpc-limiter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Earn · Henar",
  description: "Henar strategy pools on Kamino and Meteora.",
};

export default async function Page() {
  const rpc = process.env.SOLANA_RPC_URL;
  const instances = henarFlag("earnStrategies")
    ? await loadStrategyInstances({ connection: rpc ? rateLimitedConnection(rpc) : null }).catch(() => [])
    : [];
  /* Each pool's live statistics. A pool whose protocol cannot be reached is
     shown without them rather than with invented ones. */
  const stats = await Promise.all(
    instances.map((instance) =>
      statsForStrategy({ protocol: instance.market.protocol, address: instance.market.address, market: KAMINO.mainMarket }).catch(() => null),
    ),
  );
  const poolStats: Record<string, PoolStats | null> = Object.fromEntries(instances.map((instance, i) => [instance.id, stats[i]]));
  return (
    <div className="app page-earn">
      <AppHeader active="earn" />
      <main className="markets-main">
        <EarnPage
          definitions={henarFlag("earnStrategies") ? STRATEGY_DEFINITIONS : []}
          instances={instances}
          poolStats={poolStats}
          deposits={depositAvailability()}
        />
      </main>
    </div>
  );
}
