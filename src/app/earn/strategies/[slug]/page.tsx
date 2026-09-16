import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { StrategyDetail } from "@/components/strategy-detail";
import { henarFlag } from "@/lib/feature-flags";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { definitionBySlug } from "@/lib/strategies/definitions";
import { strategyInstanceBySlug } from "@/lib/strategies/engine";
import { marketRegistryReport } from "@/lib/strategies/markets";
import { evaluateStrategy } from "@/lib/strategies/runner";
import { depositAvailability, statsForStrategy } from "@/lib/strategies/pool-stats";
import { KAMINO } from "@/lib/strategies/adapters/kamino";

type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const definition = definitionBySlug((await params).slug);
  return definition ? { title: `${definition.name} · Earn · Henar` } : { title: "Strategy not found · Henar" };
}

export default async function Page({ params }: Props) {
  if (!henarFlag("earnStrategies")) notFound();
  const slug = (await params).slug;
  const definition = definitionBySlug(slug);
  if (!definition) notFound();
  const rpc = process.env.SOLANA_RPC_URL;
  const instance = await strategyInstanceBySlug(slug, { connection: rpc ? rateLimitedConnection(rpc) : null }).catch(() => null);
  if (!instance) notFound();
  const [evaluation, stats] = await Promise.all([
    evaluateStrategy(instance).catch(() => null),
    statsForStrategy({ protocol: instance.market.protocol, address: instance.market.address, market: KAMINO.mainMarket }).catch(() => null),
  ]);
  return (
    <div className="app page-earn">
      <AppHeader active="earn" />
      <main className="markets-main">
        <StrategyDetail
          definition={definition}
          instance={instance}
          proposals={evaluation?.proposals ?? []}
          markets={marketRegistryReport({ requireLimitOrders: definition.strategyType === "SMART_ACCUMULATE" })}
          stats={stats}
          deposits={depositAvailability()}
        />
      </main>
    </div>
  );
}
