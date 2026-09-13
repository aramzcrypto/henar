"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Route,
} from "lucide-react";
import { routeLabel } from "@/lib/equities/route-label";
import { EquityLogo } from "./equity-logo";
import type {
  DividendRecord,
  EarningsEvent,
  Equity,
  EquityResearch,
  FilingRecord,
  FinancialPeriod,
  NewsItem,
  ResearchSection,
} from "@/lib/equities/types";

const tabs = [
  "Overview",
  "Financials",
  "Earnings",
  "News",
  "Dividends",
  "Filings",
  "Onchain",
] as const;
type Tab = (typeof tabs)[number];
type Comparison = import("@/lib/equities/comparison").CompanyComparison;
const labels = {
  xstocks: "xStocks",
  backpack: "Backpack Securities",
  ondo: "Ondo",
} as const;
const providerLogos = {
  xstocks: "/logos/issuers/xstocks.svg",
  backpack: "/logos/issuers/backpack.svg",
  ondo: "/logos/issuers/ondo.svg",
} as const;

function value(
  number: number | null,
  kind: "money" | "percent" | "compact" = "money",
) {
  if (number === null || !Number.isFinite(number)) return "—";
  if (kind === "percent")
    return `${number.toFixed(Math.abs(number) < 0.1 ? 3 : 2)}%`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: kind === "compact" ? "compact" : "standard",
    maximumFractionDigits: kind === "compact" ? 2 : number < 10 ? 3 : 2,
  }).format(number);
}

function Unavailable({ label }: { label: string }) {
  return (
    <div className="research-unavailable">
      <span>DATA SOURCE NOT CONNECTED</span>
      <h2>{label} unavailable</h2>
      <p>Henar will show this only after a verified provider is connected.</p>
    </div>
  );
}

function date(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [, year, month, day] = match;
  return `${months[Number(month) - 1]} ${Number(day)}, ${year}`;
}

function compactNumber(raw: string | null, suffix = "") {
  if (raw === null) return "—";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "—";
  return `${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(parsed)}${suffix}`;
}

function SourceLine({ sourceUrl }: { sourceUrl: string | null }) {
  if (!sourceUrl) return null;
  const label = sourceUrl.includes("gdeltproject.org") ? "GDELT" : "SEC EDGAR";
  return (
    <a
      className="research-source"
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
    >
      Source: {label} <ExternalLink size={12} />
    </a>
  );
}

function ResearchTable({
  headings,
  rows,
  sourceUrl,
}: {
  headings: string[];
  rows: React.ReactNode[][];
  sourceUrl: string | null;
}) {
  return (
    <div className="research-section">
      <SourceLine sourceUrl={sourceUrl} />
      <div className="research-table-wrap">
        <table className="research-table">
          <thead>
            <tr>
              {headings.map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Financials({
  section,
}: {
  section: ResearchSection<FinancialPeriod[]>;
}) {
  if (section.status !== "available" || !section.data)
    return <Unavailable label="Financials" />;
  return (
    <ResearchTable
      headings={["Period", "Fiscal year", "Revenue", "Net income"]}
      rows={section.data.map((item) => [
        date(item.periodEnd),
        item.fiscalYear,
        compactNumber(item.revenue, ` ${item.currency}`),
        compactNumber(item.netIncome, ` ${item.currency}`),
      ])}
      sourceUrl={section.sourceUrl}
    />
  );
}

function Earnings({ section }: { section: ResearchSection<EarningsEvent[]> }) {
  if (section.status !== "available" || !section.data)
    return <Unavailable label="Earnings" />;
  return (
    <ResearchTable
      headings={["Reported", "Fiscal period", "Actual EPS", "Estimate"]}
      rows={section.data.map((item) => [
        date(item.reportedAt),
        item.fiscalPeriod,
        item.actualEps === null ? "—" : `$${item.actualEps}`,
        item.estimatedEps === null ? "—" : `$${item.estimatedEps}`,
      ])}
      sourceUrl={section.sourceUrl}
    />
  );
}

function Dividends({
  section,
}: {
  section: ResearchSection<DividendRecord[]>;
}) {
  if (section.status !== "available" || !section.data)
    return <Unavailable label="Dividends" />;
  return (
    <ResearchTable
      headings={["Reported period", "Filed", "Dividend per share"]}
      rows={section.data.map((item) => [
        date(item.periodEnd),
        date(item.filedAt),
        `${item.amount} ${item.currency}`,
      ])}
      sourceUrl={section.sourceUrl}
    />
  );
}

function Filings({ section }: { section: ResearchSection<FilingRecord[]> }) {
  if (section.status !== "available" || !section.data)
    return <Unavailable label="Filings" />;
  return (
    <ResearchTable
      headings={["Filed", "Form", "Accession", "Document"]}
      rows={section.data.map((item) => [
        date(item.filedAt),
        item.form,
        item.accessionNumber,
        <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
          Open filing <ExternalLink size={12} />
        </a>,
      ])}
      sourceUrl={section.sourceUrl}
    />
  );
}

function News({ section }: { section: ResearchSection<NewsItem[]> }) {
  if (section.status !== "available" || !section.data)
    return <Unavailable label="News" />;
  return (
    <div className="research-section">
      <SourceLine sourceUrl={section.sourceUrl} />
      <div className="research-news">
        {section.data.map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
            <span>
              {item.publisher} · {date(item.publishedAt.slice(0, 10))}
            </span>
            <strong>{item.headline}</strong>
            <ExternalLink size={14} />
          </a>
        ))}
      </div>
    </div>
  );
}

function OnchainTable({
  equity,
  data,
  loading,
  error,
}: {
  equity: Equity;
  data: Comparison | null;
  loading: boolean;
  error: string;
}) {
  if (loading)
    return (
      <div className="onchain-loading">
        <span />
        <span />
        <span />
      </div>
    );
  if (error || !data) return <Unavailable label="Live onchain comparison" />;
  const bestBuy = data.representations.find(
    (row) => row.representationId === data.bestBuy,
  );

  return (
    <div className="onchain-section">
      <div className="onchain-summary">
        <span>
          <small>Verified representations</small>
          <strong>{equity.representations.length}</strong>
        </span>
        <span>
          <small>Quote sources</small>
          <strong>
            {
              new Set(
                data.representations.flatMap((row) => row.executionSources),
              ).size
            }
          </strong>
        </span>
        <span>
          <small>Best quoted $10k route</small>
          <strong>
            {data.bestRoute ? routeLabel(data.bestRoute) : "Unavailable"}
          </strong>
        </span>
        <span>
          <small>Best buy price</small>
          <strong>{value(bestBuy?.executableBuyPrice ?? null)}</strong>
        </span>
      </div>
      <div className="onchain-method">
        Updated{" "}
        {new Date(data.asOf).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
        {" · "}Net quotes · Provider and Henar fees included · Network fees
        excluded · Unquoted routes not ranked
      </div>
      <section className="issuer-comparison" aria-label="Issuer comparison">
        <div className="issuer-comparison-head">
          <span>Issuer</span>
          <span>Token</span>
          <span>Reference</span>
          <span>Liquidity</span>
          <span>Access</span>
          <span>Redemption</span>
        </div>
        {data.representations.map((row) => {
          const representation = equity.representations.find(
            (item) => item.id === row.representationId,
          );
          const access = [
            row.marketStatus === "active" && "DEX",
            data.capabilities[row.representationId]?.tradeCapabilities.rfq &&
              "RFQ",
            data.capabilities[row.representationId]?.tradeCapabilities
              .primaryMint && "Mint",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div className="issuer-comparison-row" key={row.representationId}>
              <span className="issuer-name">
                <Image
                  src={providerLogos[row.provider]}
                  alt=""
                  width={22}
                  height={22}
                />
                <strong>{labels[row.provider]}</strong>
              </span>
              <strong className="issuer-token">{row.tokenSymbol}</strong>
              <span data-label="Reference">{value(row.referencePrice)}</span>
              <span data-label="Liquidity">
                {value(row.liquidityUsd, "compact")}
              </span>
              <span data-label="Access">{access || "Unavailable"}</span>
              <span data-label="Redemption">
                {representation?.redemptionModel ?? "Unavailable"}
              </span>
            </div>
          );
        })}
      </section>
      <details className="execution-details">
        <summary>Advanced execution data</summary>
        <div className="onchain-table-wrap">
          <table className="onchain-table">
            <thead>
              <tr>
                <th>Representation</th>
                <th>Buy $1k</th>
                <th>Sell ~$1k</th>
                <th>Ref.</th>
                <th>Premium</th>
                <th>Spread</th>
                <th>Liquidity</th>
                <th>24h volume</th>
                <th>Impact $1k</th>
                <th>$10k</th>
                <th>$50k</th>
                <th>Status</th>
                <th>Acquire</th>
                <th>Issuer redemption</th>
                <th>Earn</th>
              </tr>
            </thead>
            <tbody>
              {data.representations.map((row) => {
                const representation = equity.representations.find(
                  (item) => item.id === row.representationId,
                );
                const badges = [
                  data.bestBuy === row.representationId && "BEST BUY",
                  data.bestSell === row.representationId && "BEST SELL",
                  data.bestRoute?.representationId === row.representationId &&
                    "BEST QUOTED $10K",
                ].filter(Boolean);
                return (
                  <tr key={row.representationId}>
                    <td>
                      <div className="representation-name">
                        <strong>{labels[row.provider]}</strong>
                        <span>
                          {row.tokenSymbol} · <Mint value={row.mint} />
                        </span>
                        {badges.map((badge) => (
                          <i key={badge as string}>{badge}</i>
                        ))}
                      </div>
                    </td>
                    <td>{value(row.executableBuyPrice)}</td>
                    <td>{value(row.executableSellPrice)}</td>
                    <td>{value(row.referencePrice)}</td>
                    <td>{value(row.premiumDiscountPct, "percent")}</td>
                    <td>{value(row.spreadPct, "percent")}</td>
                    <td title={row.liquiditySources.join(" · ")}>
                      {value(row.liquidityUsd, "compact")}
                    </td>
                    <td title={row.liquiditySources.join(" · ")}>
                      {value(row.volume24hUsd, "compact")}
                    </td>
                    <td>{value(row.priceImpactPct["1000"], "percent")}</td>
                    <td>{value(row.priceImpactPct["10000"], "percent")}</td>
                    <td>{value(row.priceImpactPct["50000"], "percent")}</td>
                    <td>
                      <span
                        className={`route-status ${row.marketStatus}`}
                        title={`${row.executionSources.join(" · ")}${row.quoteAsOf ? ` · quoted ${new Date(row.quoteAsOf).toLocaleTimeString()}` : ""}`}
                      >
                        <i />
                        {row.marketStatus === "active"
                          ? `${row.executionSources.length} source${row.executionSources.length === 1 ? "" : "s"}`
                          : "Unavailable"}
                      </span>
                    </td>
                    <td>
                      {[
                        row.marketStatus === "active" && "DEX",
                        data.capabilities[row.representationId]
                          ?.tradeCapabilities.rfq && "RFQ",
                        data.capabilities[row.representationId]
                          ?.tradeCapabilities.primaryMint && "Mint",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td>{representation?.redemptionModel ?? "Unavailable"}</td>
                    <td>
                      {data.earn.opportunities
                        .filter(
                          (o) => o.representationId === row.representationId,
                        )
                        .map((o) => o.protocol)
                        .join(" · ") || "None verified"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <CompanyRoutes data={data} />
      <CompanyEarn equity={equity} data={data} />
      <div className="representation-terms">
        {equity.representations.map((representation) => (
          <article key={representation.id}>
            <div>
              <strong>{representation.providerLabel}</strong>
              <a
                href={representation.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Verified source <ExternalLink size={12} />
              </a>
            </div>
            <dl>
              <div>
                <dt>Mint</dt>
                <dd>
                  <Mint value={representation.mint} />
                </dd>
              </div>
              <div>
                <dt>Token program</dt>
                <dd>
                  {data.representations.find(
                    (row) => row.representationId === representation.id,
                  )?.tokenProgram ?? "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Redemption</dt>
                <dd>{representation.redemptionModel ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Dividends</dt>
                <dd>{representation.dividendTreatment ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Corporate actions</dt>
                <dd>
                  {representation.corporateActionMechanism ?? "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>DeFi</dt>
                <dd>
                  {representation.defiSupport?.join(" · ") ?? "Unavailable"}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}

function CompanyRoutes({ data }: { data: Comparison }) {
  return (
    <section
      className="company-opportunities"
      aria-label="Acquisition and redemption routes"
    >
      <h2>Acquisition & redemption</h2>
      <p>
        $10,000 buy comparison · Primary conversion and RFQ require an eligible
        Backpack account.
      </p>
      <ResearchTable
        headings={[
          "Representation",
          "Route",
          "Side",
          "Net output",
          "Effective price",
          "Status",
          "Details",
        ]}
        sourceUrl={null}
        rows={data.routes.map((route) => [
          route.tokenSymbol,
          routeLabel(route),
          route.side === "buy" ? "Buy" : "Sell",
          route.quote
            ? `${compactNumber(route.quote.outputAmount)} shares`
            : "Not quoted",
          route.quote ? value(Number(route.quote.effectivePrice)) : "—",
          route.availability === "requires_connection"
            ? "Backpack connection required"
            : route.availability === "available"
              ? "Quoted"
              : "Unavailable",
          <details key={route.id}>
            <summary>Requirements</summary>
            <p>{route.settlementNotes}</p>
            <p>{route.eligibilityRequirements.join(" · ")}</p>
            {route.destinationUrl && (
              <a href={route.destinationUrl} target="_blank" rel="noreferrer">
                {route.provider === "backpack" && route.routeType !== "DEX"
                  ? "Open Backpack"
                  : "Open trade"}{" "}
                <ExternalLink size={12} />
              </a>
            )}
          </details>,
        ])}
      />
      {!data.routes.length && <p>No verified routes currently available.</p>}
      {data.backpackStatus === "unavailable" && (
        <p>Backpack capability verification is temporarily unavailable.</p>
      )}
    </section>
  );
}

function CompanyEarn({ equity, data }: { equity: Equity; data: Comparison }) {
  return (
    <section
      className="company-opportunities"
      aria-label={`Earn ${equity.name}`}
    >
      <h2>Earn {equity.name}</h2>
      <p>
        Variable supply APY · Verify deposit availability and eligibility with
        the protocol.
      </p>
      {data.earn.opportunities.length ? (
        <ResearchTable
          sourceUrl={null}
          headings={[
            "Representation",
            "Protocol",
            "Type",
            "APY",
            "TVL",
            "Status",
            "Updated",
          ]}
          rows={equity.representations.flatMap((r) => {
            const opportunities = data.earn.opportunities.filter(
              (o) => o.representationId === r.id,
            );
            return opportunities.length
              ? opportunities.map((o) => [
                  r.tokenSymbol,
                  <a
                    key={o.id}
                    href={o.destinationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {o.protocol} <ExternalLink size={12} />
                  </a>,
                  o.opportunityType === "lending"
                    ? "Lending"
                    : o.opportunityType === "vault"
                      ? "Vault"
                      : "Liquidity pool",
                  value(o.currentAPY, "percent"),
                  value(o.tvlUsd, "compact"),
                  o.status === "available" ? "Available" : "Check availability",
                  <a
                    key={`${o.id}:source`}
                    href={o.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {new Date(o.lastUpdated).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </a>,
                ])
              : [[r.tokenSymbol, "—", "—", "—", "—", "None found", "—"]];
          })}
        />
      ) : (
        <p>No verified Earn opportunities currently available.</p>
      )}
      {data.earn.sources
        .filter((s) => s.status === "unavailable")
        .map((s) => (
          <p key={s.protocol}>
            {s.protocol}: {s.reason}
          </p>
        ))}
    </section>
  );
}

function Mint({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="mint-copy"
      title={value}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {value.slice(0, 4)}…{value.slice(-4)}{" "}
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function MarketDetail({
  equity,
  research,
}: {
  equity: Equity;
  research: EquityResearch;
}) {
  const [tab, setTab] = useState<Tab>("Onchain");
  const [snapshot, setComparison] = useState<Comparison | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const comparison = useMemo(() => {
    if (!snapshot) return null;
    const time = now || Date.now();
    const fresh = (timestamp: string | null) =>
      timestamp !== null && time - Date.parse(timestamp) < 30_000;
    const bestRoute =
      snapshot.bestRoute?.quote &&
      Date.parse(snapshot.bestRoute.quote.expiresAt) > time
        ? snapshot.bestRoute
        : null;
    return {
      ...snapshot,
      bestRoute,
      bestBuy: fresh(
        snapshot.representations.find(
          (r) => r.representationId === snapshot.bestBuy,
        )?.quoteAsOf ?? null,
      )
        ? snapshot.bestBuy
        : null,
      bestSell: fresh(
        snapshot.representations.find(
          (r) => r.representationId === snapshot.bestSell,
        )?.quoteAsOf ?? null,
      )
        ? snapshot.bestSell
        : null,
      representations: snapshot.representations.map((r) =>
        fresh(r.quoteAsOf)
          ? r
          : {
              ...r,
              marketStatus: "unknown" as const,
              executableBuyPrice: null,
              executableSellPrice: null,
              spreadPct: null,
              premiumDiscountPct: null,
            },
      ),
      routes: snapshot.routes.map((r) =>
        r.quote && Date.parse(r.quote.expiresAt) <= time
          ? { ...r, availability: "unavailable" as const, quote: null }
          : r,
      ),
    };
  }, [snapshot, now]);
  const [error, setError] = useState("");
  useEffect(() => {
    setComparison(null);
    setError("");
    const controller = new AbortController();
    let hasData = false;
    let inFlight = false;
    const load = () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      fetch(`/api/equities/${equity.ticker}/onchain`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          return response.json();
        })
        .then((next) => {
          hasData = true;
          setComparison(next);
          setError("");
        })
        .catch(() => {
          if (!controller.signal.aborted && !hasData)
            setError("Live comparison unavailable");
        })
        .finally(() => {
          inFlight = false;
        });
    };
    load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [equity.ticker]);
  const recommended = useMemo(
    () =>
      comparison?.bestBuy
        ? equity.representations.find((item) => item.id === comparison.bestBuy)
        : equity.representations[0],
    [comparison, equity.representations],
  );
  const profile =
    research.profile.status === "available" ? research.profile.data : null;
  return (
    <section className="market-detail">
      <Link href="/markets" className="back-markets">
        <ArrowLeft size={15} /> Markets
      </Link>
      <header className="company-header">
        <div className="company-identity">
          <EquityLogo logo={equity.logo} ticker={equity.ticker} size={56} />
          <div>
            <span>{equity.assetType.toUpperCase()}</span>
            <h1>{equity.name}</h1>
            <p>
              {equity.ticker} · {equity.representations.length} verified
              representation{equity.representations.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <Link
          className="company-trade"
          href={`/trade?stock=${recommended?.mint ?? ""}`}
        >
          Trade {equity.ticker}
          <ArrowUpRight size={16} />
        </Link>
      </header>
      <div className="company-market-hours">
        <span>
          US regular session{" "}
          <strong>{comparison?.traditionalMarket.status ?? "unknown"}</strong>
        </span>
        <span>
          Solana{" "}
          <strong>
            {comparison?.representations.some(
              (r) => r.marketStatus === "active",
            )
              ? "Route quoted"
              : "No active route verified"}
          </strong>
        </span>
        {comparison?.traditionalMarket.status === "closed" &&
          comparison.representations.some(
            (r) => r.marketStatus === "active",
          ) && (
            <span>
              Onchain quotes available while the regular session is closed
            </span>
          )}
      </div>
      <nav className="company-tabs" aria-label={`${equity.ticker} sections`}>
        {tabs.map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      {tab === "Onchain" ? (
        <OnchainTable
          equity={equity}
          data={comparison}
          loading={!comparison && !error}
          error={error}
        />
      ) : tab === "Overview" ? (
        <div className="company-overview">
          <article>
            <span>COMPANY</span>
            <h2>{equity.name}</h2>
            <dl>
              <div>
                <dt>Ticker</dt>
                <dd>{equity.ticker}</dd>
              </div>
              <div>
                <dt>CIK</dt>
                <dd>{profile?.cik ?? equity.cik ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Sector</dt>
                <dd>{equity.sector ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Industry</dt>
                <dd>{profile?.industry ?? equity.industry ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Headquarters</dt>
                <dd>{profile?.headquarters ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Employees</dt>
                <dd>
                  {profile?.employees?.toLocaleString("en-US") ?? "Unavailable"}
                </dd>
              </div>
            </dl>
            <SourceLine sourceUrl={research.profile.sourceUrl} />
          </article>
          <article>
            <span>ISSUERS & TICKERS</span>
            <h2>{equity.representations.length} verified options</h2>
            <div className="company-issuer-list">
              {equity.representations.map((representation) => (
                <div key={representation.id}>
                  <span>
                    <Image
                      src={providerLogos[representation.provider]}
                      alt=""
                      width={24}
                      height={24}
                    />
                    <strong>{labels[representation.provider]}</strong>
                  </span>
                  <b>{representation.tokenSymbol}</b>
                </div>
              ))}
            </div>
            <button onClick={() => setTab("Onchain")}>
              <Route size={15} /> Compare issuers
            </button>
          </article>
        </div>
      ) : tab === "Financials" ? (
        <Financials section={research.financials} />
      ) : tab === "Earnings" ? (
        <Earnings section={research.earnings} />
      ) : tab === "Dividends" ? (
        <Dividends section={research.dividends} />
      ) : tab === "Filings" ? (
        <Filings section={research.filings} />
      ) : tab === "News" ? (
        <News section={research.news} />
      ) : null}
    </section>
  );
}
