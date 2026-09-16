import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { EarnPage } from "@/components/earn-page";
import { henarFlag } from "@/lib/feature-flags";
import { FEATURED_POOL, loadEarnPools } from "@/lib/equities/earn/pools";
import { STRATEGY_DEFINITIONS } from "@/lib/strategies/definitions";
import { loadStrategyInstances } from "@/lib/strategies/engine";
import { rateLimitedConnection } from "@/lib/rpc-limiter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Earn · Henar",
  description: "Henar strategies on Kamino and Meteora, plus verified opportunities elsewhere.",
};

export default async function Page() {
  const rpc = process.env.SOLANA_RPC_URL;
  const [{ pools, notes }, instances] = await Promise.all([
    loadEarnPools().catch(() => ({ pools: [], notes: [] })),
    henarFlag("earnStrategies")
      ? loadStrategyInstances({ connection: rpc ? rateLimitedConnection(rpc) : null }).catch(() => [])
      : Promise.resolve([]),
  ]);
  return (
    <div className="app page-earn">
      <AppHeader active="earn" />
      <main className="markets-main">
        <EarnPage
          definitions={henarFlag("earnStrategies") ? STRATEGY_DEFINITIONS : []}
          instances={instances}
          featured={FEATURED_POOL}
          pools={pools}
          notes={notes}
        />
      </main>
    </div>
  );
}
