"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Layers3,
  Search,
  X,
} from "lucide-react";
import { AppSelect } from "./app-select";
import { MarketsBento } from "./markets-bento";
import { MarketsTabs } from "./markets-tabs";
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
      <span className="market-sector">
        {equity.sector ? (
          <strong>{equity.sector}</strong>
        ) : (
          <small>Unclassified</small>
        )}
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


export type SectorOption = { sector: string; companies: number };

export type SectorHighlight = {
  sector: string;
  companies: number;
  top: {
    ticker: string;
    name: string;
    logo: string | null;
    representationCount: number;
  }[];
};

export type MultiIssuerCompany = {
  ticker: string;
  name: string;
  logo: string | null;
  price: number | null;
  change: number | null;
  tokens: { provider: string; tokenSymbol: string }[];
};

export type MultiIssuerSummary = {
  twoIssuers: number;
  allIssuers: number;
  companies: MultiIssuerCompany[];
};

export type OverviewEvent = {
  id: string;
  ticker: string | null;
  companyName: string | null;
  companyLogo: string | null;
  label: string;
  date: string;
};

function SectorBlocks({
  sectors,
  onOpenSector,
}: {
  sectors: SectorHighlight[];
  onOpenSector: (sector: string) => void;
}) {
  if (!sectors.length) return null;
  return (
    <section className="sector-blocks">
      <header>
        <strong>Sectors</strong>
        <small>Classified from SEC-filed SIC codes</small>
      </header>
      <div>
        {sectors.map((block) => (
          <article key={block.sector}>
            <header>
              <button type="button" onClick={() => onOpenSector(block.sector)}>
                {block.sector}
                <ArrowRight size={12} />
              </button>
              <small>{block.companies.toLocaleString()}</small>
            </header>
            <ul>
              {block.top.map((company) => (
                <li key={company.ticker}>
                  <Link href={`/markets/${company.ticker}`}>
                    <EquityLogo
                      logo={company.logo}
                      ticker={company.ticker}
                      size={22}
                    />
                    <span className="listing-text">
                      <strong>{company.ticker}</strong>
                      <small>{company.name}</small>
                    </span>
                    <b>
                      {company.representationCount}
                      <i>rep{company.representationCount === 1 ? "" : "s"}</i>
                    </b>
                  </Link>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

const ISSUER_LABELS: Record<string, string> = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
};

function MultiIssuerBlock({
  summary,
  onOpen,
}: {
  summary: MultiIssuerSummary;
  onOpen: () => void;
}) {
  if (!summary.companies.length) return null;
  return (
    <section className="multi-issuer">
      <header>
        <div>
          <strong>Multi-provider stocks</strong>
          <small>
            {summary.allIssuers.toLocaleString()} companies are issued by all
            three providers; {summary.twoIssuers.toLocaleString()} by two.
          </small>
        </div>
        <button onClick={onOpen}>
          All markets <ArrowRight size={13} />
        </button>
      </header>
      <div className="multi-issuer-grid">
        {summary.companies.map((company) => (
          <Link key={company.ticker} href={`/markets/${company.ticker}`}>
            <span className="multi-issuer-company">
              <EquityLogo
                logo={company.logo}
                ticker={company.ticker}
                size={30}
              />
              <span className="listing-text">
                <strong>{company.ticker}</strong>
                <small>{company.name}</small>
              </span>
            </span>
            <span className="multi-issuer-price">
              <b>{company.price === null ? "—" : money(company.price)}</b>
              <i
                className={
                  company.change === null
                    ? "flat"
                    : company.change >= 0
                      ? "up"
                      : "down"
                }
              >
                {company.change === null
                  ? `${company.tokens.length} representations`
                  : `${company.change >= 0 ? "+" : ""}${company.change.toFixed(2)}% · ${company.tokens.length} issuers`}
              </i>
            </span>
            <span className="multi-issuer-tokens">
              {company.tokens.map((token) => (
                <em key={token.provider} title={ISSUER_LABELS[token.provider]}>
                  {token.tokenSymbol}
                </em>
              ))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * Collapsed to an icon until used, so the control row stays quiet. Opening it
 * focuses the field; leaving it empty and blurring collapses it again.
 */
function ExpandingSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  return (
    <div className={`markets-search-control${open || value ? " is-open" : ""}`}>
      <button
        type="button"
        aria-label="Search markets"
        aria-expanded={open || Boolean(value)}
        onClick={() => setOpen(true)}
      >
        <Search size={16} />
      </button>
      <input
        ref={field}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
        placeholder="Search company or ticker"
        aria-label="Search company or ticker"
        tabIndex={open || value ? 0 : -1}
      />
      {value ? (
        <button
          type="button"
          className="markets-search-clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function eventDay(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

function UpcomingEvents({ events }: { events: OverviewEvent[] }) {
  return (
    <section className="overview-events">
      <header>
        <strong>Events</strong>
        <Link href="/markets/calendar">
          View calendar <ArrowRight size={13} />
        </Link>
      </header>
      {events.length === 0 ? (
        <p className="overview-events-empty">
          No verified events filed in the next days. The calendar holds the full
          history and coverage detail.
        </p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/markets/${event.ticker}`}>
                <EquityLogo
                  logo={event.companyLogo}
                  ticker={event.ticker ?? "?"}
                  size={24}
                />
                <span className="listing-text">
                  <strong>{event.ticker}</strong>
                  <small>{event.companyName}</small>
                </span>
                <span className="overview-event-meta">
                  <strong>{event.label}</strong>
                  <small>{eventDay(event.date)}</small>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarketsOverviewView({
  overview,
  universe,
  sectors,
  events,
  multiIssuer,
  openAll,
  filterAll,
  filterSector,
}: {
  overview: MarketsOverview;
  universe: UniverseStats;
  sectors: SectorHighlight[];
  events: OverviewEvent[];
  multiIssuer: MultiIssuerSummary;
  openAll: () => void;
  filterAll: (kind: "asset" | "provider", value: string) => void;
  filterSector: (sector: string) => void;
}) {
  const categories = [
    ["Stocks", universe.stocks, "asset", "stock"],
    ["ETFs", universe.etfs, "asset", "etf"],
    ["xStocks", universe.xstocks, "provider", "xstocks"],
    ["Backpack", universe.backpack, "provider", "backpack"],
    ["Ondo", universe.ondo, "provider", "ondo"],
  ] as const;

  return (
    <div className="markets-overview">
      <MarketsBento
        overview={overview}
        universe={universe}
        multiIssuerCount={multiIssuer.allIssuers}
        events={events}
        onOpenAll={openAll}
      />

      <MultiIssuerBlock summary={multiIssuer} onOpen={openAll} />

      <UpcomingEvents events={events} />

      <SectorBlocks sectors={sectors} onOpenSector={filterSector} />

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
  sectors,
  sectorOptions,
  events,
  multiIssuer,
}: {
  initial: MarketsResponse;
  overview: MarketsOverview;
  universe: UniverseStats;
  sectors: SectorHighlight[];
  sectorOptions: SectorOption[];
  events: OverviewEvent[];
  multiIssuer: MultiIssuerSummary;
}) {
  const [pageView, setPageView] = useState<"overview" | "all">("overview");
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [assetType, setAssetType] = useState("all");
  const [provider, setProvider] = useState("all");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState("ticker");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useMemo(
    () => JSON.stringify({ query, assetType, provider, sector, sort }),
    [query, assetType, provider, sector, sort],
  );

  useEffect(() => {
    if (pageView !== "all") return;
    if (
      !query &&
      assetType === "all" &&
      provider === "all" &&
      sector === "all" &&
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
      if (sector !== "all") params.set("sector", sector);
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
  }, [requestKey, initial, pageView, query, assetType, provider, sector, sort]);

  const filterAll = (kind: "asset" | "provider", value: string) => {
    if (kind === "asset") setAssetType(value);
    else setProvider(value);
    setPageView("all");
  };

  const filterSector = (value: string) => {
    setSector(value);
    setPageView("all");
  };

  return (
    <section className="markets-shell">
      <h1 className="sr-only">Markets</h1>
      <div className="markets-controls">
        <MarketsTabs active={pageView} onSelect={setPageView} />
        <ExpandingSearch
          value={query}
          onChange={(next) => {
            setQuery(next);
            if (next) setPageView("all");
          }}
        />
      </div>

      {pageView === "overview" ? (
        <>
          <MarketsOverviewView
            overview={overview}
            universe={universe}
            sectors={sectors}
            events={events}
            multiIssuer={multiIssuer}
            openAll={() => setPageView("all")}
            filterAll={filterAll}
            filterSector={filterSector}
          />
        </>
      ) : (
        <>
          <div className="markets-toolbar">
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
            <AppSelect
              label="Sector"
              value={sector}
              onChange={setSector}
              options={[
                { value: "all", label: "All sectors" },
                ...sectorOptions.map((option) => ({
                  value: option.sector,
                  label: `${option.sector} (${option.companies})`,
                })),
              ]}
            />
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
              <span>Sector</span>
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
