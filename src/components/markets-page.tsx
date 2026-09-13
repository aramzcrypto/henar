"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Building2,
  Flame,
  Layers3,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AppSelect } from "./app-select";
import { EquityLogo } from "./equity-logo";
import type { EquitySummary, MarketsOverview } from "@/lib/equities/types";

type MarketsResponse = {
  items: EquitySummary[];
  total: number;
  offset: number;
  limit: number;
  rankingScope?: {
    evaluated: number;
    total: number;
    complete: boolean;
  } | null;
};

type UniverseStats = {
  companies: number;
  representations: number;
  stocks: number;
  etfs: number;
  xstocks: number;
  backpack: number;
  ondo: number;
};

const providerLabels = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
} as const;
const providerLogos = {
  xstocks: "/logos/issuers/xstocks.svg",
  backpack: "/logos/issuers/backpack.svg",
  ondo: "/logos/issuers/ondo.svg",
} as const;
const views = [
  ["ticker", "All"],
  ["most-traded", "Most traded"],
  ["top-gainers", "Top gainers"],
  ["top-losers", "Top losers"],
  ["most-liquid", "Most liquid"],
  ["recent", "Recently tokenized"],
] as const;

function money(value: number | null, compact = false) {
  if (value === null) return "—";
  if (compact) {
    const units = [
      [1_000_000_000, "B"],
      [1_000_000, "M"],
      [1_000, "K"],
    ] as const;
    const unit = units.find(([threshold]) => Math.abs(value) >= threshold);
    if (unit) {
      const scaled = value / unit[0];
      const digits = Math.abs(scaled) >= 100 ? 0 : 1;
      return `$${scaled.toFixed(digits).replace(/\.0$/, "")}${unit[1]}`;
    }
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 ? 3 : 2,
  }).format(value);
}

function changeLabel(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function ProviderPills({ equity }: { equity: EquitySummary }) {
  return (
    <span className="market-providers" aria-label="Issuers and token tickers">
      {equity.representationSymbols.map(({ provider, tokenSymbol }) => (
        <i key={`${provider}:${tokenSymbol}`} data-provider={provider}>
          <Image src={providerLogos[provider]} alt="" width={14} height={14} />
          <span>{providerLabels[provider]}</span>
          <b>{tokenSymbol}</b>
        </i>
      ))}
    </span>
  );
}

function EquityRow({ equity }: { equity: EquitySummary }) {
  const change = equity.priceChange24hPct;
  return (
    <Link href={`/markets/${equity.ticker}`} className="market-row">
      <span className="market-company">
        <EquityLogo logo={equity.logo} ticker={equity.ticker} />
        <span>
          <strong>{equity.name}</strong>
          <small>
            {equity.ticker} · {equity.assetType.toUpperCase()}
          </small>
        </span>
      </span>
      <span className="market-price">
        <strong>{money(equity.price)}</strong>
        <small
          className={
            change === null ? "" : change >= 0 ? "positive" : "negative"
          }
        >
          {change === null ? (
            "Unavailable"
          ) : (
            <>
              {change >= 0 ? (
                <ArrowUpRight size={12} />
              ) : (
                <ArrowDownRight size={12} />
              )}
              {Math.abs(change).toFixed(2)}%
            </>
          )}
        </small>
      </span>
      <ProviderPills equity={equity} />
      <span className="market-metric">
        <strong>{money(equity.onchainVolume24hUsd, true)}</strong>
        <small>24h volume</small>
      </span>
      <span className="market-metric">
        <strong>{money(equity.liquidityUsd, true)}</strong>
        <small>liquidity</small>
      </span>
      <ArrowUpRight className="market-row-arrow" size={16} />
    </Link>
  );
}

function PulseCard({
  title,
  icon,
  items,
  metric,
}: {
  title: string;
  icon: ReactNode;
  items: EquitySummary[];
  metric: "volume" | "change";
}) {
  return (
    <article className="market-pulse-card">
      <header>
        <span>{icon}</span>
        <strong>{title}</strong>
      </header>
      {items.length ? (
        <ol>
          {items.slice(0, 5).map((equity) => (
            <li key={equity.id}>
              <Link href={`/markets/${equity.ticker}`}>
                <EquityLogo
                  logo={equity.logo}
                  ticker={equity.ticker}
                  size={26}
                />
                <span>
                  <strong>{equity.name}</strong>
                  <small>{equity.ticker}</small>
                </span>
                <b
                  className={
                    metric === "volume" || equity.priceChange24hPct === null
                      ? ""
                      : equity.priceChange24hPct >= 0
                        ? "positive"
                        : "negative"
                  }
                >
                  {metric === "volume"
                    ? money(equity.onchainVolume24hUsd, true)
                    : changeLabel(equity.priceChange24hPct)}
                </b>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="market-pulse-empty">Unavailable</div>
      )}
    </article>
  );
}

function MarketBreadth({ items }: { items: EquitySummary[] }) {
  const priced = items.filter((item) => item.priceChange24hPct !== null);
  const advancing = priced.filter((item) => item.priceChange24hPct! > 0).length;
  const declining = priced.filter((item) => item.priceChange24hPct! < 0).length;
  const unchanged = priced.length - advancing - declining;
  const advanceShare = priced.length ? (advancing / priced.length) * 100 : 0;

  return (
    <article className="market-breadth-card">
      <header>
        <span>
          <Activity size={16} />
        </span>
        <strong>Market breadth</strong>
        <small>Live matches</small>
      </header>
      {priced.length ? (
        <div className="market-breadth-content">
          <div className="market-breadth-score">
            <strong>{Math.round(advanceShare)}%</strong>
            <span>advancing</span>
          </div>
          <div
            className="market-breadth-bar"
            aria-label={`${advancing} advancing and ${declining} declining`}
          >
            <i style={{ width: `${advanceShare}%` }} />
          </div>
          <dl>
            <div>
              <dt>Advancing</dt>
              <dd className="positive">{advancing}</dd>
            </div>
            <div>
              <dt>Declining</dt>
              <dd className="negative">{declining}</dd>
            </div>
            <div>
              <dt>Unchanged</dt>
              <dd>{unchanged}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="market-pulse-empty">Unavailable</div>
      )}
    </article>
  );
}

function OverviewTable({ items }: { items: EquitySummary[] }) {
  return (
    <section className="overview-table-card">
      <header>
        <div>
          <Layers3 size={15} />
          <strong>Active on Henar</strong>
        </div>
        <span>Jupiter · 24h</span>
      </header>
      <div className="overview-table-head">
        <span>Company</span>
        <span>Price</span>
        <span>Change</span>
        <span>Issuers & tickers</span>
        <span>Volume</span>
        <span>Liquidity</span>
        <span />
      </div>
      {items.slice(0, 8).map((equity) => (
        <Link
          href={`/markets/${equity.ticker}`}
          className="overview-market-row"
          key={equity.id}
        >
          <span className="market-company">
            <EquityLogo logo={equity.logo} ticker={equity.ticker} size={28} />
            <span>
              <strong>{equity.name}</strong>
              <small>{equity.ticker}</small>
            </span>
          </span>
          <strong>{money(equity.price)}</strong>
          <i
            className={
              equity.priceChange24hPct === null
                ? ""
                : equity.priceChange24hPct >= 0
                  ? "positive"
                  : "negative"
            }
          >
            {changeLabel(equity.priceChange24hPct)}
          </i>
          <ProviderPills equity={equity} />
          <span>{money(equity.onchainVolume24hUsd, true)}</span>
          <span>{money(equity.liquidityUsd, true)}</span>
          <ArrowRight size={14} />
        </Link>
      ))}
      {!items.length ? (
        <div className="markets-empty">
          Live market activity is unavailable.
        </div>
      ) : null}
    </section>
  );
}

function MarketsOverviewView({
  overview,
  universe,
  openAll,
  filterAll,
}: {
  overview: MarketsOverview;
  universe: UniverseStats;
  openAll: () => void;
  filterAll: (kind: "asset" | "provider", value: string) => void;
}) {
  const live = overview.items.filter((item) => item.price !== null);
  const gainers = [...live]
    .filter(
      (item) => item.priceChange24hPct !== null && item.priceChange24hPct > 0,
    )
    .sort((a, b) => b.priceChange24hPct! - a.priceChange24hPct!);
  const losers = [...live]
    .filter(
      (item) => item.priceChange24hPct !== null && item.priceChange24hPct < 0,
    )
    .sort((a, b) => a.priceChange24hPct! - b.priceChange24hPct!);
  const categories = [
    ["Stocks", universe.stocks, "asset", "stock"],
    ["ETFs", universe.etfs, "asset", "etf"],
    ["xStocks", universe.xstocks, "provider", "xstocks"],
    ["Backpack", universe.backpack, "provider", "backpack"],
    ["Ondo", universe.ondo, "provider", "ondo"],
  ] as const;

  return (
    <div className="markets-overview">
      <section className="markets-overview-strip">
        <div>
          <span>UNIFIED ONCHAIN EQUITIES</span>
          <h2>One company. Every valid representation.</h2>
          <p>xStocks · Backpack · Ondo</p>
        </div>
        <dl>
          <div>
            <dt>Companies</dt>
            <dd>{universe.companies.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Representations</dt>
            <dd>{universe.representations.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Live matches</dt>
            <dd>{overview.matchedCompanyCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Tracked volume</dt>
            <dd>{money(overview.totalVolume24hUsd, true)}</dd>
          </div>
        </dl>
      </section>

      <div className="market-pulse-grid">
        <PulseCard
          title="Most traded"
          icon={<Flame size={15} />}
          items={overview.items}
          metric="volume"
        />
        <PulseCard
          title="Gainers"
          icon={<TrendingUp size={15} />}
          items={gainers}
          metric="change"
        />
        <PulseCard
          title="Losers"
          icon={<TrendingDown size={15} />}
          items={losers}
          metric="change"
        />
        <MarketBreadth items={live} />
      </div>

      <section className="market-categories">
        <header>
          <strong>Explore</strong>
          <button onClick={openAll}>
            All markets <ArrowRight size={13} />
          </button>
        </header>
        <div>
          {categories.map(([label, count, kind, value]) => (
            <button key={label} onClick={() => filterAll(kind, value)}>
              <Building2 size={15} />
              <span>
                <strong>{label}</strong>
                <small>{count.toLocaleString()}</small>
              </span>
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      </section>

      <OverviewTable items={overview.items} />
      <p className="overview-source">
        Exact verified mint matches from Jupiter’s top-traded feed. Prices and
        activity update live.
      </p>
    </div>
  );
}

export function MarketsPage({
  initial,
  overview,
  universe,
}: {
  initial: MarketsResponse;
  overview: MarketsOverview;
  universe: UniverseStats;
}) {
  const [pageView, setPageView] = useState<"overview" | "all">("overview");
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [assetType, setAssetType] = useState("all");
  const [provider, setProvider] = useState("all");
  const [sort, setSort] = useState("ticker");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useMemo(
    () => JSON.stringify({ query, assetType, provider, sort }),
    [query, assetType, provider, sort],
  );

  useEffect(() => {
    if (pageView !== "all") return;
    if (
      !query &&
      assetType === "all" &&
      provider === "all" &&
      sort === "ticker"
    ) {
      setData(initial);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ q: query, sort, limit: "50" });
      if (assetType !== "all") params.set("assetType", assetType);
      if (provider !== "all") params.set("provider", provider);
      try {
        const response = await fetch(`/api/equities?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        setData(await response.json());
      } catch {
        if (!controller.signal.aborted)
          setError("Markets are unavailable. Try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, initial, pageView, query, assetType, provider, sort]);

  const filterAll = (kind: "asset" | "provider", value: string) => {
    if (kind === "asset") setAssetType(value);
    else setProvider(value);
    setPageView("all");
  };

  return (
    <section className="markets-shell">
      <div className="markets-heading markets-heading-compact">
        <div>
          <h1>Markets</h1>
          <span>{universe.companies.toLocaleString()} verified companies</span>
        </div>
        <div className="markets-page-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={pageView === "overview"}
            className={pageView === "overview" ? "active" : ""}
            onClick={() => setPageView("overview")}
          >
            Overview
          </button>
          <button
            role="tab"
            aria-selected={pageView === "all"}
            className={pageView === "all" ? "active" : ""}
            onClick={() => setPageView("all")}
          >
            All markets
          </button>
        </div>
      </div>

      {pageView === "overview" ? (
        <>
          <label className="markets-search markets-overview-search">
            <Search size={16} />
            <input
              placeholder="Search company or ticker"
              aria-label="Search markets"
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value) setPageView("all");
              }}
            />
          </label>
          <MarketsOverviewView
            overview={overview}
            universe={universe}
            openAll={() => setPageView("all")}
            filterAll={filterAll}
          />
        </>
      ) : (
        <>
          <div className="markets-toolbar">
            <label className="markets-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search company or ticker"
                aria-label="Search markets"
              />
            </label>
            <AppSelect
              label="Asset type"
              value={assetType}
              onChange={setAssetType}
              options={[
                { value: "all", label: "Stocks & ETFs" },
                { value: "stock", label: "Stocks" },
                { value: "etf", label: "ETFs" },
              ]}
            />
            <AppSelect
              label="Provider"
              value={provider}
              onChange={setProvider}
              options={[
                { value: "all", label: "All providers" },
                { value: "xstocks", label: "xStocks" },
                { value: "backpack", label: "Backpack" },
                { value: "ondo", label: "Ondo" },
              ]}
            />
            <button
              className="markets-sector"
              disabled
              title="Sector data source not connected"
            >
              All sectors
            </button>
          </div>
          <div className="market-views" role="tablist" aria-label="Market view">
            {views.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={sort === value}
                className={sort === value ? "active" : ""}
                disabled={value === "recent"}
                title={
                  value === "recent"
                    ? "Verified tokenization dates are not connected"
                    : undefined
                }
                onClick={() => setSort(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {data.rankingScope && !data.rankingScope.complete ? (
            <p className="markets-ranking-scope">
              Live ranking covers {data.rankingScope.evaluated} of{" "}
              {data.rankingScope.total.toLocaleString()} matches.
            </p>
          ) : null}
          <div
            className={`market-list ${loading ? "loading" : ""}`}
            aria-busy={loading}
          >
            <div className="market-list-head">
              <span>Company</span>
              <span>Reference</span>
              <span>Issuers & tickers</span>
              <span>24h volume</span>
              <span>Liquidity</span>
              <span />
            </div>
            {error ? (
              <div className="markets-empty">{error}</div>
            ) : data.items.length ? (
              data.items.map((equity) => (
                <EquityRow key={equity.id} equity={equity} />
              ))
            ) : (
              <div className="markets-empty">No verified companies found.</div>
            )}
          </div>
          <div className="markets-footnote">
            <span>Reference prices. Trade requests a fresh route.</span>
            <span>Unavailable data is never estimated.</span>
          </div>
        </>
      )}
    </section>
  );
}
