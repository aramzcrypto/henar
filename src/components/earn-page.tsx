"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import { FeaturedStrategies, StrategyDisclosure } from "./earn-strategies";
import { POOL_TYPE_LABELS, type EarnPool } from "@/lib/equities/earn/pools";
import type { StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";

type Filter = "all" | "lending" | "vault" | "liquidity_pool";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["lending", "Lending"],
  ["vault", "Vaults"],
  ["liquidity_pool", "LPs"],
];

const PROVIDER_LABELS: Record<string, string> = { xstocks: "xStocks", backpack: "Backpack", ondo: "Ondo" };

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}
function usd(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Earn: Henar's own strategies first, then the directory of opportunities
 * that live on other protocols. The two are kept visibly apart — Henar
 * operates the first and merely indexes the second.
 */
export function EarnPage({
  definitions,
  instances,
  featured,
  pools,
  notes,
}: {
  definitions: StrategyDefinition[];
  instances: StrategyInstance[];
  featured: EarnPool;
  pools: EarnPool[];
  notes: { protocol: string; reason: string | null }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => (filter === "all" ? pools : pools.filter((p) => p.type === filter)), [filter, pools]);

  return (
    <div className="earn-pools">
      <div className="earn-page-heading">
        <h1>Earn</h1>
        <p>Put your cash and stocks to work.</p>
      </div>

      <div className="strategy-section-head">
        <h2>Henar strategies</h2>
        <StrategyDisclosure compact />
      </div>
      <FeaturedStrategies definitions={definitions} instances={instances} />

      <div className="strategy-section-head secondary">
        <h2>Explore opportunities</h2>
        <p>
          Verified markets on other protocols. Henar reads them; it does not operate them or route deposits into them.
        </p>
      </div>

      <Link href={`/earn/${featured.slug}`} className="earn-banner">
        <div className="earn-banner-main">
          <span className="earn-banner-label">Henar protocol product</span>
          <h2>{featured.name}</h2>
          <p>{featured.summary}</p>
          <span className="earn-banner-protocol">Powered by {featured.protocol}</span>
        </div>
        <div className="earn-banner-side">
          <dl>
            <div>
              <dt>Deposit</dt>
              <dd>{featured.depositAsset}</dd>
            </div>
            <div>
              <dt>Yield goes to</dt>
              <dd>Stocks or Packs</dd>
            </div>
          </dl>
          <span className="earn-banner-cta">
            Open <ArrowRight size={14} />
          </span>
        </div>
      </Link>

      <div className="earn-filters" role="group" aria-label="Opportunity type">
        {FILTERS.map(([value, label]) => (
          <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="fin-empty">No verified opportunities of this type right now.</p>
      ) : (
        <div className="earn-pool-list">
          <div className="earn-pool-head">
            <span>Market</span>
            <span>Protocol</span>
            <span>Type</span>
            <span>Supply APY</span>
            <span>TVL</span>
            <span />
          </div>
          {rows.map((pool) => (
            <Link className="earn-pool-row" key={pool.slug} href={`/earn/${pool.slug}`}>
              <span className="earn-pool-market">
                <EquityLogo logo={pool.companyLogo} ticker={pool.ticker ?? pool.name} size={32} />
                <span>
                  <strong>{pool.company ?? pool.name}</strong>
                  <small>
                    {pool.representation}
                    {pool.provider ? ` · ${PROVIDER_LABELS[pool.provider] ?? pool.provider}` : ""}
                  </small>
                </span>
              </span>
              <span>{pool.protocol}</span>
              <span>{POOL_TYPE_LABELS[pool.type]}</span>
              <span>{percent(pool.apy)}</span>
              <span>{usd(pool.tvlUsd)}</span>
              <span className="earn-pool-arrow">
                <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <p className="onchain-method">
          <Info size={12} /> {notes.map((n) => `${n.protocol}: ${n.reason ?? "unavailable"}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
