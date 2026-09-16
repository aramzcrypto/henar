"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { rateIsStrategyReturn, type DepositAvailability } from "@/lib/strategies/presentation";
import type { PoolStats } from "@/lib/strategies/pool-stats";
import type { StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";

export function usd(value: number | null | undefined, compact = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (compact) {
    if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function ComingSoonTag({ label }: { label: string }) {
  return <span className="earn-tag earn-tag-soon">{label}</span>;
}

/**
 * The one figure a pool leads with.
 *
 * A cash-yield pool has a rate and a market-making pool has a fee rate. An
 * accumulation pool has neither — its return is the price it pays — so it
 * leads with the price instead of borrowing a number it does not earn.
 */
export function headlineFigure(instance: StrategyInstance, stats: PoolStats | null) {
  if (!rateIsStrategyReturn(instance.strategyType)) {
    const price = instance.state.kind === "SMART_ACCUMULATE" ? instance.state.currentReference : null;
    return { value: price ? `$${Number(price).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—", label: `${instance.market.assetSymbol ?? "Stock"} price` };
  }
  if (!stats?.rate) return { value: "—", label: "Rate unavailable" };
  return { value: `${stats.rate.value.toFixed(2)}%`, label: stats.rate.label };
}

/** Earn: three pools, each live on its protocol, none open for deposits yet. */
export function EarnPage({
  definitions,
  instances,
  poolStats,
  deposits,
}: {
  definitions: StrategyDefinition[];
  instances: StrategyInstance[];
  poolStats: Record<string, PoolStats | null>;
  deposits: DepositAvailability;
}) {
  const pools = definitions
    .map((definition) => {
      const instance = instances.find((i) => i.definitionId === definition.id) ?? null;
      return instance ? { definition, instance, stats: poolStats[instance.id] ?? null } : null;
    })
    .filter((row): row is { definition: StrategyDefinition; instance: StrategyInstance; stats: PoolStats | null } => row !== null);

  return (
    <div className="earn-pools">
      <div className="earn-page-heading">
        <h1>Earn</h1>
        <p>Put your cash and stocks to work.</p>
      </div>

      {pools.length === 0 ? (
        <p className="fin-empty">Pools are unavailable right now.</p>
      ) : (
        <div className="pool-cards">
          {pools.map(({ definition, instance, stats }) => {
            const figure = headlineFigure(instance, stats);
            return (
              <Link className="pool-card" key={definition.id} href={`/earn/strategies/${definition.slug}`}>
                <div className="pool-card-top">
                  <span className="pool-card-protocol">{definition.protocols[0]}</span>
                  <ComingSoonTag label={deposits.label} />
                </div>
                <h2>{instance.name}</h2>
                <p>{definition.summary}</p>
                <div className="pool-card-figure">
                  <strong>{figure.value}</strong>
                  <small>{figure.label}</small>
                </div>
                <dl className="pool-card-facts">
                  <div>
                    <dt>Deposit</dt>
                    <dd>{definition.deposits}</dd>
                  </div>
                  <div>
                    <dt>Pool size</dt>
                    <dd>{usd(stats?.liquidityUsd)}</dd>
                  </div>
                </dl>
                <span className="pool-card-cta">
                  View pool <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <p className="onchain-method earn-footnote">
        Each pool is live on its protocol. Depositing through Henar is not built yet.
      </p>
    </div>
  );
}
