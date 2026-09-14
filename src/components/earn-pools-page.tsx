"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Info, Sprout } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import {
  POOL_TYPE_LABELS,
  type EarnPool,
} from "@/lib/equities/earn/pools";

type Filter = "all" | "lending" | "vault" | "liquidity_pool";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["lending", "Lending"],
  ["vault", "Vaults"],
  ["liquidity_pool", "LPs"],
];

const PROVIDER_LABELS: Record<string, string> = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
};

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

export function StatusTag({ status }: { status: EarnPool["status"] }) {
  return status === "live" ? (
    <span className="earn-tag earn-tag-live">Live</span>
  ) : (
    <span className="earn-tag earn-tag-soon">Coming soon</span>
  );
}

export function EarnPoolsPage({
  featured,
  pools,
  notes,
}: {
  featured: EarnPool;
  pools: EarnPool[];
  notes: { protocol: string; reason: string | null }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(
    () => (filter === "all" ? pools : pools.filter((p) => p.type === filter)),
    [filter, pools],
  );

  return (
    <div className="earn-pools">
      <div className="earn-page-heading">
        <h1>Earn</h1>
        <p>Put idle capital to work and turn the yield into stock exposure.</p>
      </div>

      <Link href={`/earn/${featured.slug}`} className="earn-banner">
        <div className="earn-banner-main">
          <span className="earn-banner-label">
            <Sprout size={13} /> Featured strategy
            <StatusTag status="live" />
          </span>
          <h2>{featured.name}</h2>
          <p>{featured.summary}</p>
          <span className="earn-banner-protocol">
            Powered by {featured.protocol}
          </span>
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
            Open strategy <ArrowRight size={15} />
          </span>
        </div>
      </Link>

      <section className="earn-pool-list">
        <header>
          <div>
            <h2>Stock pools</h2>
            <p>
              Verified Solana markets where a tokenized stock earns yield. Henar
              reads them live; deposit routing is being wired.
            </p>
          </div>
          <div className="stock-earn-filters" role="tablist">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="stock-earn-empty">
            No verified pools of this type are connected yet.
          </p>
        ) : (
          <div className="stock-earn-scroll">
            <table className="stock-earn-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Deposit</th>
                  <th>Protocol</th>
                  <th>Type</th>
                  <th className="num">APY</th>
                  <th className="num">TVL</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((pool) => (
                  <tr key={pool.slug}>
                    <td>
                      <Link
                        href={`/earn/${pool.slug}`}
                        className="stock-earn-company"
                      >
                        <EquityLogo
                          logo={pool.companyLogo}
                          ticker={pool.ticker ?? "?"}
                          size={26}
                        />
                        <span>
                          <b>{pool.ticker}</b>
                          <i>{pool.company}</i>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="stock-earn-rep">
                        {pool.representation}
                      </span>
                      <small>
                        {pool.provider
                          ? (PROVIDER_LABELS[pool.provider] ?? pool.provider)
                          : ""}
                      </small>
                    </td>
                    <td>{pool.protocol}</td>
                    <td>{POOL_TYPE_LABELS[pool.type]}</td>
                    <td className="num">{percent(pool.apy)}</td>
                    <td className="num">{usd(pool.tvlUsd)}</td>
                    <td>
                      <StatusTag status={pool.status} />
                    </td>
                    <td className="num">
                      <Link href={`/earn/${pool.slug}`} className="stock-earn-open">
                        View <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {notes.length ? (
          <p className="stock-earn-note">
            <Info size={13} />
            <span>
              {notes
                .map((note) => `${note.protocol}: ${note.reason}`)
                .join(" ")}
            </span>
          </p>
        ) : null}
        <p className="stock-earn-source">
          Live reserve data from Kamino. APY is variable and never estimated — an
          unavailable rate shows as —.
        </p>
      </section>
    </div>
  );
}
