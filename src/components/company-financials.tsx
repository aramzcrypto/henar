"use client";

import { useMemo, useState } from "react";
import type { FinancialPeriod, ResearchSection } from "@/lib/equities/types";

type View = "highlights" | "income" | "balance" | "cash";
type Frame = "annual" | "quarterly";

const VIEWS: [View, string][] = [
  ["highlights", "Highlights"],
  ["income", "Income statement"],
  ["balance", "Balance sheet"],
  ["cash", "Cash flow"],
];

function num(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Compact USD with a sign, or an em dash when the concept was not filed. */
function money(value: string | null) {
  const parsed = num(value);
  if (parsed === null) return "—";
  const sign = parsed < 0 ? "-" : "";
  const abs = Math.abs(parsed);
  if (abs >= 1_000_000_000_000)
    return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function eps(value: string | null) {
  const parsed = num(value);
  if (parsed === null) return "—";
  return `${parsed < 0 ? "-" : ""}$${Math.abs(parsed).toFixed(2)}`;
}

function ratio(numerator: string | null, denominator: string | null) {
  const top = num(numerator);
  const bottom = num(denominator);
  if (top === null || bottom === null || bottom === 0) return "—";
  return `${((top / bottom) * 100).toFixed(1)}%`;
}

/** Free cash flow is operating cash flow less capital expenditure. */
function freeCashFlow(period: FinancialPeriod) {
  const operating = num(period.operatingCashFlow);
  const capex = num(period.capitalExpenditure);
  if (operating === null) return null;
  return String(capex === null ? operating : operating - capex);
}

function changePct(current: string | null, previous: string | null) {
  const now = num(current);
  const before = num(previous);
  if (now === null || before === null || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

function periodLabel(period: FinancialPeriod) {
  const suffix =
    period.fiscalPeriod && period.fiscalPeriod !== "FY"
      ? ` ${period.fiscalPeriod}`
      : " FY";
  return `${period.fiscalYear}${suffix}`;
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <small className={value >= 0 ? "positive" : "negative"}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}% YoY
    </small>
  );
}

function Highlights({ periods }: { periods: FinancialPeriod[] }) {
  const latest = periods[0];
  // The same fiscal period one year earlier is the honest YoY comparison.
  const prior = periods.find(
    (period) =>
      period.fiscalYear === latest.fiscalYear - 1 &&
      period.fiscalPeriod === latest.fiscalPeriod,
  );

  const metrics: {
    label: string;
    value: string;
    delta: number | null;
  }[] = [
    {
      label: "Revenue",
      value: money(latest.revenue),
      delta: prior ? changePct(latest.revenue, prior.revenue) : null,
    },
    {
      label: "Gross profit",
      value: money(latest.grossProfit),
      delta: prior ? changePct(latest.grossProfit, prior.grossProfit) : null,
    },
    {
      label: "Operating income",
      value: money(latest.operatingIncome),
      delta: prior
        ? changePct(latest.operatingIncome, prior.operatingIncome)
        : null,
    },
    {
      label: "Net income",
      value: money(latest.netIncome),
      delta: prior ? changePct(latest.netIncome, prior.netIncome) : null,
    },
    {
      label: "Free cash flow",
      value: money(freeCashFlow(latest)),
      delta: prior ? changePct(freeCashFlow(latest), freeCashFlow(prior)) : null,
    },
    {
      label: "Cash & equivalents",
      value: money(latest.cash),
      delta: prior ? changePct(latest.cash, prior.cash) : null,
    },
    {
      label: "Gross margin",
      value: ratio(latest.grossProfit, latest.revenue),
      delta: null,
    },
    {
      label: "Net margin",
      value: ratio(latest.netIncome, latest.revenue),
      delta: null,
    },
    { label: "EPS (diluted)", value: eps(latest.eps), delta: null },
  ];

  const chartPeriods = [...periods]
    .filter((period) => num(period.revenue) !== null)
    .slice(0, 8)
    .reverse();
  const peak = Math.max(
    ...chartPeriods.flatMap((period) => [
      Math.abs(num(period.revenue) ?? 0),
      Math.abs(num(period.netIncome) ?? 0),
    ]),
    1,
  );

  return (
    <>
      <div className="fin-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            <Delta value={metric.delta} />
          </div>
        ))}
      </div>

      {chartPeriods.length > 1 ? (
        <section className="fin-chart">
          <header>
            <strong>Profitability</strong>
            <span className="fin-legend">
              <i className="fin-key-revenue" /> Revenue
              <i className="fin-key-income" /> Net income
            </span>
          </header>
          <div className="fin-bars">
            {chartPeriods.map((period) => {
              const revenue = Math.abs(num(period.revenue) ?? 0);
              const income = num(period.netIncome);
              return (
                <div key={`${period.periodEnd}-${period.fiscalPeriod}`}>
                  <span className="fin-bar-pair">
                    <i
                      className="fin-key-revenue"
                      style={{ height: `${(revenue / peak) * 100}%` }}
                      title={`Revenue ${money(period.revenue)}`}
                    />
                    <i
                      className={
                        income !== null && income < 0
                          ? "fin-key-loss"
                          : "fin-key-income"
                      }
                      style={{
                        height: `${(Math.abs(income ?? 0) / peak) * 100}%`,
                      }}
                      title={`Net income ${money(period.netIncome)}`}
                    />
                  </span>
                  <small>{periodLabel(period)}</small>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}

const ROWS: Record<
  Exclude<View, "highlights">,
  { label: string; field: keyof FinancialPeriod; kind?: "eps" }[]
> = {
  income: [
    { label: "Revenue", field: "revenue" },
    { label: "Gross profit", field: "grossProfit" },
    { label: "Operating income", field: "operatingIncome" },
    { label: "Net income", field: "netIncome" },
    { label: "EPS (diluted)", field: "eps", kind: "eps" },
  ],
  balance: [
    { label: "Total assets", field: "assets" },
    { label: "Total liabilities", field: "liabilities" },
    { label: "Shareholders' equity", field: "equity" },
    { label: "Cash & equivalents", field: "cash" },
  ],
  cash: [
    { label: "Operating cash flow", field: "operatingCashFlow" },
    { label: "Investing cash flow", field: "investingCashFlow" },
    { label: "Financing cash flow", field: "financingCashFlow" },
    { label: "Capital expenditure", field: "capitalExpenditure" },
  ],
};

function Statement({
  view,
  periods,
}: {
  view: Exclude<View, "highlights">;
  periods: FinancialPeriod[];
}) {
  const columns = periods.slice(0, 6);
  const rows = ROWS[view];
  const hasAnyValue = rows.some((row) =>
    columns.some((period) => num(period[row.field] as string | null) !== null),
  );
  if (!hasAnyValue)
    return (
      <p className="fin-empty">
        These statement lines were not present in the filed XBRL data for this
        company.
      </p>
    );
  return (
    <div className="fin-table-scroll">
      <table className="fin-table">
        <thead>
          <tr>
            <th>Line item</th>
            {columns.map((period) => (
              <th
                key={`${period.periodEnd}-${period.fiscalPeriod}`}
                className="num"
              >
                {periodLabel(period)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {columns.map((period) => {
                const raw = period[row.field] as string | null;
                return (
                  <td
                    key={`${period.periodEnd}-${period.fiscalPeriod}`}
                    className="num"
                  >
                    {row.kind === "eps" ? eps(raw) : money(raw)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompanyFinancials({
  section,
}: {
  section: ResearchSection<FinancialPeriod[]>;
}) {
  const [view, setView] = useState<View>("highlights");
  const [frame, setFrame] = useState<Frame>("annual");

  const periods = useMemo(() => {
    const all = section.data ?? [];
    const scoped = all.filter((period) => period.frame === frame);
    // Fall back to whatever the company actually filed rather than showing an
    // empty table because one frame is missing.
    return (scoped.length ? scoped : all)
      .slice()
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  }, [section.data, frame]);

  if (section.status !== "available" || !section.data || !section.data.length)
    return (
      <div className="research-unavailable">
        <span>DATA SOURCE NOT CONNECTED</span>
        <h2>Financials unavailable</h2>
        <p>Henar will show this only after a verified provider is connected.</p>
      </div>
    );

  return (
    <div className="company-financials">
      <div className="fin-toolbar">
        <div className="fin-views" role="tablist">
          {VIEWS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={view === value}
              className={view === value ? "active" : ""}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="fin-frames" role="tablist">
          {(["annual", "quarterly"] as Frame[]).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={frame === value}
              className={frame === value ? "active" : ""}
              onClick={() => setFrame(value)}
            >
              {value === "annual" ? "Annual" : "Quarterly"}
            </button>
          ))}
        </div>
      </div>

      {periods.length === 0 ? (
        <p className="fin-empty">No filed periods for this selection.</p>
      ) : view === "highlights" ? (
        <Highlights periods={periods} />
      ) : (
        <Statement view={view} periods={periods} />
      )}

      {section.sourceUrl ? (
        <a
          className="research-source"
          href={section.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Source: SEC EDGAR
        </a>
      ) : null}
    </div>
  );
}
