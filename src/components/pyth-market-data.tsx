"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Equity } from "@/lib/equities/types";
import type { CompanyPyth, RepresentationPyth } from "@/lib/pyth/company";
import { assessFairValue, FAIR_VALUE_LABELS, formatBps } from "@/lib/pyth/fair-value";
import type { FairValueAssessment, PythAvailability, PythCandle, PythReference } from "@/lib/pyth/types";

type Comparison = import("@/lib/equities/comparison").CompanyComparison;

const labels: Record<string, string> = { xstocks: "xStocks", backpack: "Backpack Securities", ondo: "Ondo" };
const providerLogos: Record<string, string> = { xstocks: "/logos/issuers/xstocks.svg", backpack: "/logos/issuers/backpack.svg", ondo: "/logos/issuers/ondo.svg" };

const AVAILABILITY: Record<PythAvailability, string> = {
  AVAILABLE: "Live",
  CATALOG_ONLY: "In Pyth catalog · not yet live",
  NOT_ENTITLED: "Not entitled",
  STALE: "Stale",
  UNAVAILABLE: "No Pyth feed",
  INVALID: "Invalid key",
  NOT_CONFIGURED: "Key not configured",
};

const SESSION: Record<string, string> = { regular: "Regular session", preMarket: "Pre-market", postMarket: "Post-market", overNight: "Overnight", closed: "Closed" };

function money(text: string | null | undefined, digits = 2) {
  if (!text) return "—";
  const n = Number(text);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : digits }).format(n);
}

function age(ref: PythReference | null, now: number) {
  if (!ref?.feedUpdatedAt) return "age unknown";
  const ms = Math.max(0, now - Date.parse(ref.feedUpdatedAt));
  if (ms < 1000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${(ms / 3_600_000).toFixed(1)}h ago`;
}

function Freshness({ reference, now }: { reference: PythReference | null; now: number }) {
  if (!reference) return <em className="pyth-fresh unknown">—</em>;
  return (
    <em className={`pyth-fresh ${reference.freshness}`} title={reference.feedUpdatedAt ?? undefined}>
      {reference.freshness === "live" ? "Live" : reference.freshness === "carried-forward" ? "Carried forward" : reference.freshness === "stale" ? "Stale" : "Unknown"} · {age(reference, now)}
    </em>
  );
}

function statusClass(status: FairValueAssessment["status"]) {
  return status === "OK" ? "ok" : status === "WARNING" || status === "COMPARABILITY_UNVERIFIED" ? "warn" : status === "REFERENCE_UNAVAILABLE" ? "muted" : "bad";
}

/**
 * Pyth Pro market data for one public company: the underlying equity
 * reference, each verified tokenized representation's reference, and the
 * fair-value engine's read of the executable Henar route against them.
 * Every figure keeps its source; unavailable stays unavailable.
 */
export function PythMarketData({ equity, comparison }: { equity: Equity; comparison: Comparison | null }) {
  const [data, setData] = useState<CompanyPyth | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "off" | "error">("loading");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    /* The first read always happens; only the polling pauses on a hidden tab.
       Skipping the first one too leaves the panel reading "loading" forever
       for anyone who opens the page in a background tab. */
    const load = (force = false) => {
      if ((document.hidden && !force) || inFlight) return;
      inFlight = true;
      fetch(`/api/equities/${equity.ticker}/pyth`, { signal: controller.signal })
        .then(async (response) => {
          if (response.status === 404) {
            setStatus("off");
            return null;
          }
          if (!response.ok) throw new Error();
          return (await response.json()) as CompanyPyth;
        })
        .then((next) => {
          if (next) {
            setData(next);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus((s) => (s === "ready" ? s : "error"));
        })
        .finally(() => {
          inFlight = false;
        });
    };
    load(true);
    const interval = window.setInterval(() => load(), 15_000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      controller.abort();
    };
  }, [equity.ticker]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.representations.map((row) => {
      const live = comparison?.representations.find((r) => r.representationId === row.representationId);
      const executable = live?.executableBuyPrice !== null && live?.executableBuyPrice !== undefined && live.quoteAsOf
        ? { price: String(live.executableBuyPrice), side: "buy" as const, source: `Henar $${comparison?.comparisonNotionalUsd ?? 1000} buy route`, quotedAt: live.quoteAsOf }
        : null;
      const assessment = assessFairValue({ representationId: row.representationId, underlying: data.underlying.reference, token: row.reference, redemptionRate: row.redemptionRate, executable, now });
      return { row, assessment, executable };
    });
  }, [data, comparison, now]);

  if (status === "off") return null;
  if (status === "error" && !data)
    return (
      <section className="pyth-panel" aria-label="Pyth market data">
        <PanelHead ticker={equity.ticker} />
        <p className="fin-empty">Pyth market data is unavailable right now.</p>
      </section>
    );
  if (!data)
    return (
      <section className="pyth-panel" aria-busy="true" aria-label="Pyth market data">
        <PanelHead ticker={equity.ticker} />
        <p className="fin-empty">Reading Pyth Pro references.</p>
      </section>
    );

  const u = data.underlying;
  const mapped = data.representations.filter((r) => r.feed);
  const liveTokens = data.representations.filter((r) => r.reference);
  const headline = rows.find((r) => r.assessment.status !== "REFERENCE_UNAVAILABLE")?.assessment ?? null;
  const entitlementNote =
    data.status === "NOT_CONFIGURED"
      ? "Pyth Pro key is not configured on this deployment; feed mappings come from the public catalog, prices are unavailable."
      : data.status === "INVALID"
        ? "The configured Pyth Pro key was rejected."
        : data.status === "NOT_ENTITLED"
          ? "The current Pyth Pro entitlement does not cover these feeds."
          : data.status === "UNAVAILABLE"
            ? `Pyth is unavailable${data.detail ? `: ${data.detail}` : "."}`
            : null;

  return (
    <section className="pyth-panel" aria-label="Pyth market data">
      <PanelHead ticker={equity.ticker} />
      <div className="onchain-summary pyth-summary">
        <span>
          <small>Underlying · {u.feed?.symbol ?? "no Pyth feed"}</small>
          <strong>{money(u.reference?.price)}</strong>
          {u.reference ? (
            <b className="pyth-sub">
              {SESSION[u.reference.marketSession ?? ""] ?? "Session unknown"} · <Freshness reference={u.reference} now={now} />
            </b>
          ) : (
            <b className="pyth-sub">{AVAILABILITY[u.availability]}</b>
          )}
        </span>
        <span>
          <small>Data quality</small>
          <strong>{u.reference?.publisherCount ?? liveTokens[0]?.reference?.publisherCount ?? "—"}</strong>
          <b className="pyth-sub">
            publishers · confidence {u.reference?.confidenceBps ?? liveTokens[0]?.reference?.confidenceBps ?? "—"} bps
          </b>
        </span>
        <span>
          <small>Tokenized references</small>
          <strong>
            {liveTokens.length} / {equity.representations.length}
          </strong>
          <b className="pyth-sub">{mapped.length} mapped in the Pyth catalog</b>
        </span>
        <span>
          <small>Protection status</small>
          <strong className={`pyth-status ${headline ? statusClass(headline.status) : "muted"}`}>{headline ? FAIR_VALUE_LABELS[headline.status] : "No Pyth reference"}</strong>
          <b className="pyth-sub">{headline?.executionReference === "tokenized" ? "Execution reference: tokenized market" : headline?.executionReference === "underlying" ? "Execution reference: underlying market" : "Existing Henar rules apply"}</b>
        </span>
      </div>
      {entitlementNote && <p className="onchain-method pyth-note">{entitlementNote}</p>}
      <div className="issuer-comparison pyth-table">
        <div className="issuer-comparison-head pyth-row">
          <span>Issuer</span>
          <span>Token</span>
          <span>Pyth token reference</span>
          <span>Token basis</span>
          <span>Execution deviation</span>
          <span>Status</span>
        </div>
        {rows.map(({ row, assessment, executable }) => (
          <div className="issuer-comparison-row pyth-row" key={row.representationId}>
            <span className="issuer-name">
              <Image src={providerLogos[row.provider] ?? providerLogos.xstocks} alt="" width={22} height={22} />
              <strong>{labels[row.provider] ?? row.provider}</strong>
            </span>
            <strong className="issuer-token">{row.tokenSymbol}</strong>
            <span data-label="Pyth token reference">
              {row.reference ? (
                <>
                  <strong>{money(row.reference.price)}</strong>
                  <br />
                  <Freshness reference={row.reference} now={now} />
                </>
              ) : (
                <span className="value-muted" title={row.unmappedReason ?? undefined}>
                  {row.feed ? AVAILABILITY[row.availability] : (row.unmappedReason ?? "No Pyth feed")}
                </span>
              )}
            </span>
            <span data-label="Token basis" title={assessment.comparability === "redemption-rate" ? `Pyth redemption rate ${row.redemptionRate?.price ?? "—"} (${row.redemptionRateFeed?.symbol ?? ""})` : "No verified token/share conversion"}>
              {assessment.tokenVsUnderlyingBps !== null ? formatBps(assessment.tokenVsUnderlyingBps) : row.reference && u.reference ? <span className="value-muted">Unverified</span> : "—"}
            </span>
            <span data-label="Execution deviation" title={executable ? `${executable.source} at ${money(executable.price)}` : "No executable route quoted"}>
              {assessment.routeVsTokenBps !== null ? formatBps(assessment.routeVsTokenBps) : "—"}
            </span>
            <span data-label="Status">
              <em className={`pyth-status ${statusClass(assessment.status)}`}>{FAIR_VALUE_LABELS[assessment.status]}</em>
            </span>
          </div>
        ))}
      </div>
      <details className="execution-details">
        <summary>Representation history · Pyth Pro</summary>
        <PythHistoryChart ticker={equity.ticker} data={data} />
      </details>
      <p className="onchain-method">
        Pyth Pro references · {data.observedAt ? `read ${new Date(data.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""} · Confidence is price uncertainty, not volatility · Token basis uses only a Pyth-published redemption rate · Execution deviation compares the Henar route with the tokenized reference
      </p>
    </section>
  );
}

function PanelHead({ ticker }: { ticker: string }) {
  return (
    <div className="pyth-panel-head">
      <div>
        <h2>Market data</h2>
        <p>Underlying and tokenized references for {ticker}, with Henar&apos;s executable route measured against them.</p>
      </div>
      <Link href="/markets/data" className="pyth-powered">
        Powered by Pyth Pro
      </Link>
    </div>
  );
}

type Series = { key: string; label: string; symbol: string; candles: PythCandle[]; status: string };

const RESOLUTION = "60";
const RESOLUTION_SECONDS = 3_600;
const WINDOW_SECONDS = 7 * 86_400;

/**
 * Hand-drawn SVG line chart over Pyth history. Series are normalized to
 * their first close so representations trade on one axis; a gap wider than
 * two bars breaks the line rather than being interpolated.
 */
function PythHistoryChart({ ticker, data }: { ticker: string; data: CompanyPyth }) {
  const candidates = useMemo(() => {
    const list: { key: string; label: string; symbol: string }[] = [];
    if (data.underlying.feed) list.push({ key: "underlying", label: ticker, symbol: data.underlying.feed.symbol });
    for (const row of data.representations) if (row.feed) list.push({ key: row.representationId, label: row.tokenSymbol, symbol: row.feed.symbol });
    return list;
  }, [data, ticker]);
  const [selected, setSelected] = useState<string[]>([]);
  const [series, setSeries] = useState<Record<string, Series>>({});
  useEffect(() => {
    setSelected(candidates.slice(0, 2).map((c) => c.key));
  }, [candidates]);
  useEffect(() => {
    const missing = candidates.filter((c) => selected.includes(c.key) && !series[c.key]);
    if (!missing.length) return;
    const controller = new AbortController();
    const to = Math.floor(Date.now() / 1000);
    for (const c of missing) {
      const params = new URLSearchParams({ ticker, symbol: c.symbol, resolution: RESOLUTION, from: String(to - WINDOW_SECONDS), to: String(to) });
      fetch(`/api/pyth/history?${params}`, { signal: controller.signal })
        .then(async (r) => (r.ok ? r.json() : { status: "UNAVAILABLE", candles: [] }))
        .then((h: { status: string; candles: PythCandle[] }) => setSeries((s) => ({ ...s, [c.key]: { ...c, candles: h.candles ?? [], status: h.status } })))
        .catch(() => {});
    }
    return () => controller.abort();
  }, [candidates, selected, series, ticker]);

  if (!candidates.length) return <p className="fin-empty">No Pyth feeds are mapped for this company.</p>;
  const active = selected.map((k) => series[k]).filter((s): s is Series => Boolean(s) && s.candles.length > 1);
  const width = 720, height = 220, pad = 8;
  const t0 = Math.min(...active.map((s) => s.candles[0].t));
  const t1 = Math.max(...active.map((s) => s.candles[s.candles.length - 1].t));
  const paths = active.map((s, i) => {
    const base = Number(s.candles[0].c);
    const values = s.candles.map((c) => (Number(c.c) / base - 1) * 100);
    return { s, i, values };
  });
  const all = paths.flatMap((p) => p.values);
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - lo) / Math.max(0.0001, hi - lo)) * (height - 2 * pad);
  /* The shared chart palette, so the series stay legible on a light ground
     instead of washing out. */
  const colors = ["var(--viz-rose)", "var(--viz-blue)", "var(--viz-amber)", "var(--viz-green)"];
  return (
    <div className="pyth-chart">
      <div className="pyth-chart-tabs" role="group" aria-label="Series">
        {candidates.map((c, i) => {
          const on = selected.includes(c.key);
          const s = series[c.key];
          const unavailable = s && s.candles.length < 2;
          return (
            <button key={c.key} className={on ? "active" : ""} style={{ ["--series" as string]: colors[i % colors.length] }} onClick={() => setSelected((cur) => (on ? cur.filter((k) => k !== c.key) : [...cur, c.key]))}>
              <i />
              {c.label}
              {on && unavailable ? <small> · {s.status === "NOT_CONFIGURED" ? "key not configured" : s.status === "NOT_ENTITLED" ? "not entitled" : s.status === "NO_DATA" ? "no data" : s.status === "UNAVAILABLE" ? "unavailable" : "no history"}</small> : null}
            </button>
          );
        })}
      </div>
      {active.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ticker} 7-day Pyth history, normalized`}>
          <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} className="pyth-chart-zero" />
          {paths.map(({ s, values }) => {
            const idx = candidates.findIndex((c) => c.key === s.key);
            let d = "";
            let prev: number | null = null;
            s.candles.forEach((c, k) => {
              const gap = prev !== null && c.t - prev > 2 * RESOLUTION_SECONDS;
              d += `${prev === null || gap ? "M" : "L"}${x(c.t).toFixed(1)},${y(values[k]).toFixed(1)} `;
              prev = c.t;
            });
            return <path key={s.key} d={d} fill="none" stroke={colors[idx % colors.length]} strokeWidth={1.5} />;
          })}
        </svg>
      ) : (
        <p className="fin-empty">{selected.length ? (Object.keys(series).length ? "No history available under the current Pyth Pro entitlement." : "Loading Pyth history.") : "Select a series."}</p>
      )}
      <p className="onchain-method">7 days · hourly closes normalized to the first bar · gaps are left as gaps · Pyth Pro history API</p>
    </div>
  );
}

export type { RepresentationPyth };
