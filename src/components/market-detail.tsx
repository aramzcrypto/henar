"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, use, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Route,
} from "lucide-react";
import { routeLabel } from "@/lib/equities/route-label";
import { CompanyFinancials } from "./company-financials";
import { EquityLogo } from "./equity-logo";
import type {
  DividendRecord,
  EarningsEvent,
  Equity,
  EquityResearch,
  FilingRecord,
  NewsItem,
  ResearchSection,
} from "@/lib/equities/types";

const tabs = [
  "Overview",
  "Chart",
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

// Research streams in after the shell paints. Each tab resolves the shared
// promise behind its own Suspense boundary so one slow section never blocks
// the rest of the page.
function ResearchPending({ label }: { label: string }) {
  return (
    <div className="research-pending" aria-busy="true">
      <span>LOADING</span>
      <h2>{label}</h2>
      <p>Retrieving verified filings data.</p>
    </div>
  );
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

function Earnings({ section }: { section: ResearchSection<EarningsEvent[]> }) {
  if (section.status !== "available" || !section.data || !section.data.length)
    return <Unavailable label="Earnings" />;
  const history = [...section.data].sort((a, b) =>
    b.reportedAt.localeCompare(a.reportedAt),
  );
  const latest = history[0];
  return (
    <div className="research-section">
      <div className="research-summary">
        <div>
          <dt>Last reported</dt>
          <dd>{date(latest.reportedAt)}</dd>
        </div>
        <div>
          <dt>Fiscal period</dt>
          <dd>{latest.fiscalPeriod || "—"}</dd>
        </div>
        <div>
          <dt>Actual EPS</dt>
          <dd>{latest.actualEps === null ? "—" : `$${latest.actualEps}`}</dd>
        </div>
        <div>
          <dt>Estimated EPS</dt>
          <dd>
            {latest.estimatedEps === null ? "—" : `$${latest.estimatedEps}`}
          </dd>
        </div>
        <div>
          <dt>Next earnings</dt>
          <dd className="value-muted">Provider required</dd>
        </div>
      </div>
      <p className="research-caption">
        SEC EDGAR publishes results once filed. Forward dates, revenue estimates
        and surprise need a calendar provider.
      </p>
      <ResearchTable
        headings={["Reported", "Fiscal period", "Actual EPS", "Estimate"]}
        rows={history.map((item) => [
          date(item.reportedAt),
          item.fiscalPeriod,
          item.actualEps === null ? "—" : `$${item.actualEps}`,
          item.estimatedEps === null ? "—" : `$${item.estimatedEps}`,
        ])}
        sourceUrl={section.sourceUrl}
      />
    </div>
  );
}

function Dividends({
  section,
}: {
  section: ResearchSection<DividendRecord[]>;
}) {
  if (section.status !== "available" || !section.data || !section.data.length)
    return <Unavailable label="Dividends" />;
  const history = [...section.data].sort((a, b) =>
    b.periodEnd.localeCompare(a.periodEnd),
  );
  const latest = history[0];
  // Cadence is inferred only from the gap between two filed periods.
  const gapMonths =
    history.length > 1
      ? Math.round(
          (Date.parse(`${history[0].periodEnd}T00:00:00Z`) -
            Date.parse(`${history[1].periodEnd}T00:00:00Z`)) /
            (30.44 * 86_400_000),
        )
      : null;
  const frequency =
    gapMonths === null
      ? "—"
      : gapMonths <= 1
        ? "Monthly"
        : gapMonths <= 4
          ? "Quarterly"
          : gapMonths <= 7
            ? "Semi-annual"
            : "Annual";
  return (
    <div className="research-section">
      <div className="research-summary">
        <div>
          <dt>Last dividend</dt>
          <dd>
            {latest.amount} {latest.currency}
          </dd>
        </div>
        <div>
          <dt>Period end</dt>
          <dd>{date(latest.periodEnd)}</dd>
        </div>
        <div>
          <dt>Frequency</dt>
          <dd>{frequency}</dd>
        </div>
        <div>
          <dt>Dividend yield</dt>
          <dd className="value-muted">Unavailable</dd>
        </div>
        <div>
          <dt>Ex-date</dt>
          <dd className="value-muted">Unavailable</dd>
        </div>
      </div>
      <p className="research-caption">
        Amounts are declared dividends per share from filed XBRL data. Yield and
        ex-dates require a market data provider.
      </p>
      <ResearchTable
        headings={["Reported period", "Filed", "Dividend per share"]}
        rows={history.map((item) => [
          date(item.periodEnd),
          date(item.filedAt),
          `${item.amount} ${item.currency}`,
        ])}
        sourceUrl={section.sourceUrl}
      />
    </div>
  );
}

const FORM_DESCRIPTIONS: Record<string, string> = {
  "10-K": "Annual report",
  "10-Q": "Quarterly report",
  "8-K": "Current report — material event",
  "20-F": "Annual report (foreign issuer)",
  "40-F": "Annual report (Canadian issuer)",
  "6-K": "Interim report (foreign issuer)",
};

function Filings({ section }: { section: ResearchSection<FilingRecord[]> }) {
  if (section.status !== "available" || !section.data)
    return <Unavailable label="Filings" />;
  return (
    <ResearchTable
      headings={["Form", "Filed", "Description", "Document"]}
      rows={section.data.map((item) => [
        <span key={`${item.accessionNumber}-form`} className="filing-form">
          {item.form}
        </span>,
        date(item.filedAt),
        FORM_DESCRIPTIONS[item.form.replace("/A", "")] ??
          "Periodic or current report",
        <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
          Open <ExternalLink size={12} />
        </a>,
      ])}
      sourceUrl={section.sourceUrl}
    />
  );
}

function relativeTime(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return date(iso.slice(0, 10));
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date(iso.slice(0, 10));
}

function News({ section }: { section: ResearchSection<NewsItem[]> }) {
  if (section.status !== "available" || !section.data || !section.data.length)
    return <Unavailable label="News" />;
  return (
    <div className="research-section">
      <ol className="news-list">
        {section.data.map((item) => (
          <li key={item.id}>
            <a href={item.url} target="_blank" rel="noreferrer">
              <strong>{item.headline}</strong>
              <span>
                <em>{item.publisher}</em>
                <i>{relativeTime(item.publishedAt)}</i>
              </span>
            </a>
            <ExternalLink size={13} />
          </li>
        ))}
      </ol>
      <SourceLine sourceUrl={section.sourceUrl} />
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

type ResearchPromise = Promise<EquityResearch>;

function FinancialsTab({ research }: { research: ResearchPromise }) {
  return <CompanyFinancials section={use(research).financials} />;
}
function EarningsTab({ research }: { research: ResearchPromise }) {
  return <Earnings section={use(research).earnings} />;
}
function DividendsTab({ research }: { research: ResearchPromise }) {
  return <Dividends section={use(research).dividends} />;
}
function FilingsTab({ research }: { research: ResearchPromise }) {
  return <Filings section={use(research).filings} />;
}
function NewsTab({ research }: { research: ResearchPromise }) {
  return <News section={use(research).news} />;
}

function ProfileFacts({
  equity,
  research,
}: {
  equity: Equity;
  research: ResearchPromise;
}) {
  const section = use(research).profile;
  const profile = section.status === "available" ? section.data : null;
  return (
    <>
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
          <dd>{profile?.employees?.toLocaleString("en-US") ?? "Unavailable"}</dd>
        </div>
      </dl>
      <SourceLine sourceUrl={section.sourceUrl} />
    </>
  );
}

function ProfileFactsPending({ equity }: { equity: Equity }) {
  return (
    <dl aria-busy="true">
      <div>
        <dt>Ticker</dt>
        <dd>{equity.ticker}</dd>
      </div>
      {["CIK", "Sector", "Industry", "Headquarters", "Employees"].map(
        (label) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="value-pending">—</dd>
          </div>
        ),
      )}
    </dl>
  );
}

const PRICE_WINDOWS: [keyof Comparison["representations"][number]["priceWindows"], string][] = [
  ["m5", "5m"],
  ["h1", "1h"],
  ["h6", "6h"],
  ["h24", "24h"],
];

/**
 * Jupiter publishes price change over fixed windows but no OHLC series, so this
 * compares verified movement per representation rather than drawing a price
 * history it cannot source.
 */
function PriceMovement({
  equity,
  data,
  error,
}: {
  equity: Equity;
  data: Comparison | null;
  error: string;
}) {
  if (!data)
    return error ? (
      <Unavailable label="Price movement" />
    ) : (
      <div className="research-pending" aria-busy="true">
        <span>LOADING</span>
        <h2>Price movement</h2>
        <p>Reading live representation prices.</p>
      </div>
    );

  const rows = equity.representations.map((representation) => ({
    representation,
    live: data.representations.find(
      (row) => row.representationId === representation.id,
    ),
  }));
  const peak = Math.max(
    ...rows.flatMap(({ live }) =>
      PRICE_WINDOWS.map(([key]) => Math.abs(live?.priceWindows?.[key] ?? 0)),
    ),
    0.5,
  );

  const anyMovement = rows.some(({ live }) =>
    PRICE_WINDOWS.some(([key]) => live?.priceWindows?.[key] != null),
  );

  return (
    <div className="price-movement">
      <div className="price-movement-head">
        <div>
          <h2>Price movement</h2>
          <p>
            Verified change per issuer representation across the windows Jupiter
            publishes.
          </p>
        </div>
      </div>

      {!anyMovement ? (
        <p className="fin-empty">
          No verified price movement is available for this company right now.
        </p>
      ) : (
        <div className="price-movement-grid">
          {rows.map(({ representation, live }) => (
            <article key={representation.id}>
              <header>
                <span>
                  <Image
                    src={providerLogos[representation.provider]}
                    alt=""
                    width={18}
                    height={18}
                  />
                  {labels[representation.provider]}
                </span>
                <b>{representation.tokenSymbol}</b>
              </header>
              <div className="price-movement-price">
                <strong>{value(live?.referencePrice ?? null)}</strong>
                <small>{value(live?.liquidityUsd ?? null, "compact")} liquidity</small>
              </div>
              <div className="price-movement-bars">
                {PRICE_WINDOWS.map(([key, label]) => {
                  const change = live?.priceWindows?.[key] ?? null;
                  const height =
                    change === null
                      ? 0
                      : Math.max((Math.abs(change) / peak) * 100, 3);
                  return (
                    <div key={key}>
                      <span className="price-movement-track">
                        <i
                          className={
                            change === null
                              ? "flat"
                              : change >= 0
                                ? "up"
                                : "down"
                          }
                          style={{ height: `${height}%` }}
                        />
                      </span>
                      <b
                        className={
                          change === null
                            ? "value-muted"
                            : change >= 0
                              ? "positive"
                              : "negative"
                        }
                      >
                        {change === null
                          ? "—"
                          : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                      </b>
                      <small>{label}</small>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="calendar-note">
        <span>
          <strong>Full price history requires a market data provider.</strong>{" "}
          Henar does not store or interpolate an OHLC series, so no candlestick
          chart is shown until a verified feed is connected.
        </span>
      </p>
    </div>
  );
}

type Headline = {
  price: number | null;
  change: number | null;
  volume: number | null;
  liquidity: number | null;
  marketCap: number | null;
  holders: number | null;
};

function statNumber(raw: string | null | undefined) {
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Blends live onchain figures with the latest filed fundamentals. Anything the
 * filings do not contain — a P/E without a share count, a 52-week range without
 * price history — stays explicitly unavailable.
 */
function KeyStats({
  research,
  headline,
}: {
  research: ResearchPromise;
  headline: Headline;
}) {
  const resolved = use(research);
  const periods = resolved.financials.data ?? [];
  const latest = periods[0];
  const eps = statNumber(latest?.eps);
  const revenue = statNumber(latest?.revenue);
  const netIncome = statNumber(latest?.netIncome);
  const priceEarnings =
    headline.price !== null && eps !== null && eps > 0
      ? (headline.price / eps).toFixed(1)
      : null;

  const stats: [string, string][] = [
    ["Price", value(headline.price)],
    ["Market cap", value(headline.marketCap, "compact")],
    [
      "24h change",
      headline.change === null ? "—" : `${headline.change.toFixed(2)}%`,
    ],
    ["24h volume", value(headline.volume, "compact")],
    ["Liquidity", value(headline.liquidity, "compact")],
    ["EPS (diluted)", eps === null ? "—" : `$${eps.toFixed(2)}`],
    ["P/E", priceEarnings ?? "—"],
    ["Revenue", value(revenue, "compact")],
    ["Net income", value(netIncome, "compact")],
    [
      "Onchain holders",
      headline.holders === null
        ? "—"
        : headline.holders.toLocaleString("en-US"),
    ],
  ];

  return (
    <dl className="company-keystats">
      {stats.map(([label, text]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={text === "—" ? "value-muted" : undefined}>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function KeyStatsPending() {
  return (
    <dl className="company-keystats" aria-busy="true">
      {[
        "Price",
        "Market cap",
        "24h change",
        "24h volume",
        "Liquidity",
        "EPS (diluted)",
        "P/E",
        "Revenue",
        "Net income",
        "Onchain holders",
      ].map((label) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="value-pending">—</dd>
        </div>
      ))}
    </dl>
  );
}

function OverviewEvent({
  research,
  onOpen,
}: {
  research: ResearchPromise;
  onOpen: () => void;
}) {
  const section = use(research).earnings;
  const latest = [...(section.data ?? [])].sort((a, b) =>
    b.reportedAt.localeCompare(a.reportedAt),
  )[0];
  if (!latest) return null;
  return (
    <article>
      <span>LATEST EVENT</span>
      <h2>Earnings</h2>
      <dl className="company-onchain-facts">
        <div>
          <dt>Reported</dt>
          <dd>{date(latest.reportedAt)}</dd>
        </div>
        <div>
          <dt>Fiscal period</dt>
          <dd>{latest.fiscalPeriod || "—"}</dd>
        </div>
        <div>
          <dt>Actual EPS</dt>
          <dd>{latest.actualEps === null ? "—" : `$${latest.actualEps}`}</dd>
        </div>
        <div>
          <dt>Next earnings</dt>
          <dd className="value-muted">Provider required</dd>
        </div>
      </dl>
      <button onClick={onOpen}>Earnings history</button>
    </article>
  );
}

function OverviewNews({
  research,
  onOpen,
}: {
  research: ResearchPromise;
  onOpen: () => void;
}) {
  const section = use(research).news;
  const items = (section.data ?? []).slice(0, 4);
  if (!items.length) return null;
  return (
    <article>
      <span>LATEST NEWS</span>
      <h2>Coverage</h2>
      <div className="company-overview-news">
        {items.map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
            <strong>{item.headline}</strong>
            <small>
              {item.publisher} · {date(item.publishedAt.slice(0, 10))}
            </small>
          </a>
        ))}
      </div>
      <button onClick={onOpen}>All news</button>
    </article>
  );
}

export function MarketDetail({
  equity,
  research,
}: {
  equity: Equity;
  research: ResearchPromise;
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
  /**
   * Header figures come from the deepest representation for price and change,
   * and are summed across representations for volume and liquidity. A missing
   * value stays null rather than becoming zero.
   */
  const headline = useMemo(() => {
    const rows = comparison?.representations ?? [];
    const sum = (pick: (row: (typeof rows)[number]) => number | null) => {
      const values = rows
        .map(pick)
        .filter((value): value is number => value !== null);
      return values.length ? values.reduce((total, v) => total + v, 0) : null;
    };
    const deepest = [...rows].sort(
      (a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1),
    )[0];
    return {
      price: deepest?.referencePrice ?? null,
      change: deepest?.priceChange24hPct ?? null,
      volume: sum((row) => row.volume24hUsd),
      liquidity: sum((row) => row.liquidityUsd),
      // Market cap is a property of the company, not a sum across mints.
      marketCap: deepest?.marketCapUsd ?? null,
      holders: sum((row) => row.holderCount),
    };
  }, [comparison]);
  return (
    <section className="market-detail">
      <Link href="/markets" className="back-markets">
        <ArrowLeft size={15} /> Markets
      </Link>
      <header className="company-header">
        <div className="company-identity">
          <EquityLogo
            logo={equity.logo}
            ticker={equity.ticker}
            size={56}
            priority
          />
          <div>
            <span>
              {equity.assetType.toUpperCase()}
              {equity.sector ? ` · ${equity.sector}` : ""}
            </span>
            <h1>{equity.name}</h1>
            <p>{equity.ticker}</p>
          </div>
          <div className="company-quote">
            <strong>{value(headline.price)}</strong>
            <small
              className={
                headline.change === null
                  ? "value-muted"
                  : headline.change >= 0
                    ? "positive"
                    : "negative"
              }
            >
              {headline.change === null
                ? "Change unavailable"
                : `${headline.change >= 0 ? "+" : ""}${headline.change.toFixed(2)}%`}
            </small>
          </div>
        </div>
        <div className="company-header-side">
          <dl className="company-header-stats">
            <div>
              <dt>Market cap</dt>
              <dd>{value(headline.marketCap, "compact")}</dd>
            </div>
            <div>
              <dt>24h volume</dt>
              <dd>{value(headline.volume, "compact")}</dd>
            </div>
            <div>
              <dt>Liquidity</dt>
              <dd>{value(headline.liquidity, "compact")}</dd>
            </div>
            <div>
              <dt>Next earnings</dt>
              <dd className="value-muted">—</dd>
            </div>
          </dl>
          <Link
            className="company-trade"
            href={`/trade?stock=${recommended?.mint ?? ""}`}
          >
            Trade {equity.ticker}
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <div className="company-context">
        <div>
          <span>Traditional market</span>
          <strong>
            {comparison?.traditionalMarket.status
              ? `US regular session · ${comparison.traditionalMarket.status}`
              : "US regular session · unknown"}
          </strong>
        </div>
        <div>
          <span>Solana</span>
          <strong>
            {equity.representations.length} representation
            {equity.representations.length === 1 ? "" : "s"} ·{" "}
            {comparison?.representations.some((r) => r.marketStatus === "active")
              ? "Trading"
              : "No active route verified"}
          </strong>
        </div>
        <div className="company-context-issuers">
          <span>Issuers</span>
          <div>
            {[
              ...new Set(equity.representations.map((item) => item.provider)),
            ].map((provider) => (
              <em key={provider}>
                <Image
                  src={providerLogos[provider]}
                  alt=""
                  width={14}
                  height={14}
                />
                {labels[provider]}
              </em>
            ))}
          </div>
        </div>
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
          <Suspense fallback={<KeyStatsPending />}>
            <KeyStats research={research} headline={headline} />
          </Suspense>
          <div className="company-overview-grid">
            <article>
              <span>COMPANY</span>
              <h2>{equity.name}</h2>
              <Suspense fallback={<ProfileFactsPending equity={equity} />}>
                <ProfileFacts equity={equity} research={research} />
              </Suspense>
            </article>
            <article>
              <span>ONCHAIN SNAPSHOT</span>
              <h2>
                {equity.representations.length} verified representation
                {equity.representations.length === 1 ? "" : "s"}
              </h2>
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
              <dl className="company-onchain-facts">
                <div>
                  <dt>Trading</dt>
                  <dd>
                    {comparison?.representations.some(
                      (r) => r.marketStatus === "active",
                    )
                      ? "Route quoted"
                      : "No active route verified"}
                  </dd>
                </div>
                <div>
                  <dt>Best route</dt>
                  <dd>
                    {comparison?.bestRoute
                      ? routeLabel(comparison.bestRoute)
                      : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Earn opportunities</dt>
                  <dd>
                    {comparison?.earn
                      ? comparison.earn.opportunities.length
                      : "—"}
                  </dd>
                </div>
              </dl>
              <button onClick={() => setTab("Onchain")}>
                <Route size={15} /> Compare issuers
              </button>
            </article>
            <Suspense fallback={null}>
              <OverviewEvent research={research} onOpen={() => setTab("Earnings")} />
            </Suspense>
            <Suspense fallback={null}>
              <OverviewNews research={research} onOpen={() => setTab("News")} />
            </Suspense>
          </div>
        </div>
      ) : tab === "Chart" ? (
        <PriceMovement equity={equity} data={comparison} error={error} />
      ) : tab === "Financials" ? (
        <Suspense fallback={<ResearchPending label="Financials" />}>
          <FinancialsTab research={research} />
        </Suspense>
      ) : tab === "Earnings" ? (
        <Suspense fallback={<ResearchPending label="Earnings" />}>
          <EarningsTab research={research} />
        </Suspense>
      ) : tab === "Dividends" ? (
        <Suspense fallback={<ResearchPending label="Dividends" />}>
          <DividendsTab research={research} />
        </Suspense>
      ) : tab === "Filings" ? (
        <Suspense fallback={<ResearchPending label="Filings" />}>
          <FilingsTab research={research} />
        </Suspense>
      ) : tab === "News" ? (
        <Suspense fallback={<ResearchPending label="News" />}>
          <NewsTab research={research} />
        </Suspense>
      ) : null}
    </section>
  );
}
