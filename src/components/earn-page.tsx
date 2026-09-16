"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { rateIsStrategyReturn, type DepositAvailability } from "@/lib/strategies/presentation";
import type { PoolStats } from "@/lib/strategies/pool-stats";
import type { StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";

export function usd(value: number | null | undefined, compact = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (compact) {
    if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function ComingSoonTag({ label }: { label: string }) {
  return <span className="earn-tag earn-tag-soon">{label}</span>;
}

/** The pair or asset the pool trades, for the row subtitle. */
function poolLabel(instance: StrategyInstance, stats: PoolStats | null) {
  const protocol = instance.market.protocol === "kamino" ? "Kamino" : "Meteora DLMM";
  if (instance.market.protocol === "kamino") return `${protocol} · ${instance.market.quoteSymbol} reserve`;
  return `${protocol} · ${stats?.pair ?? `${instance.market.assetSymbol}/${instance.market.quoteSymbol}`}`;
}

/**
 * The headline figure for a pool.
 *
 * A cash-yield pool has a supply rate and a market-making pool has a fee
 * rate. An accumulation pool has neither — its return is the price it pays —
 * so it shows the price rather than borrowing a yield number that would not
 * mean anything.
 */
function headline(instance: StrategyInstance, stats: PoolStats | null) {
  if (!rateIsStrategyReturn(instance.strategyType)) {
    const price = instance.state.kind === "SMART_ACCUMULATE" ? instance.state.currentReference : null;
    return { value: price ? `$${Number(price).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—", label: `${instance.market.assetSymbol ?? "Stock"} price` };
  }
  if (!stats?.rate) return { value: "—", label: "Rate unavailable" };
  return { value: `${stats.rate.value.toFixed(2)}%`, label: `${stats.rate.label} · ${stats.rate.window}` };
}

/**
 * Earn: three strategy pools.
 *
 * Each pool is real and running on its protocol. What is not built is
 * Henar's deposit path into it, which is what "coming soon" refers to.
 */
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
  const rows = definitions
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

      {rows.length === 0 ? (
        <p className="fin-empty">Strategy pools are unavailable right now.</p>
      ) : (
        <div className="earn-pool-list">
          <div className="earn-pool-head strategy-pool-row">
            <span>Pool</span>
            <span>Deposit</span>
            <span>Rate</span>
            <span>Pool size</span>
            <span>Status</span>
            <span />
          </div>
          {rows.map(({ definition, instance, stats }) => {
            const figure = headline(instance, stats);
            return (
              <Link className="earn-pool-row strategy-pool-row" key={definition.id} href={`/earn/strategies/${definition.slug}`}>
                <span className="earn-pool-market">
                  <span>
                    <strong>{instance.name}</strong>
                    <small>{poolLabel(instance, stats)}</small>
                  </span>
                </span>
                <span className="strategy-pool-deposit">{definition.deposits}</span>
                <span className="strategy-pool-rate">
                  <b>{figure.value}</b>
                  <small>{figure.label}</small>
                </span>
                <span>{usd(stats?.liquidityUsd)}</span>
                <span>
                  <ComingSoonTag label={deposits.label} />
                </span>
                <span className="earn-pool-arrow">
                  <ArrowRight size={14} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <p className="onchain-method earn-footnote">
        Each pool is live on its own protocol; depositing into one through Henar is not built yet. Rates are read from{" "}
        {[...new Set(rows.map(({ stats }) => stats?.rate?.source).filter(Boolean))].join(" and ") || "their protocols"} and carry the window they were measured over. Henar&apos;s existing USDC product is at{" "}
        <Link href="/earn/usdc-stocks">Earn stocks</Link>.
      </p>
    </div>
  );
}
