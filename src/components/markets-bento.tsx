"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import { InfoTip } from "./info-tip";
import type { EquitySummary, MarketsOverview } from "@/lib/equities/types";

type Universe = {
  companies: number;
  representations: number;
  stocks: number;
  etfs: number;
  xstocks: number;
  backpack: number;
  ondo: number;
};

const ISSUERS: Record<string, string> = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
};

/* Through the chart palette rather than as literals, so an issuer keeps its
   identity in both themes: the dark hues are tuned to glow on near-black and
   go pastel and unreadable on white. */
const ISSUER_COLOURS: Record<string, string> = {
  xstocks: "var(--viz-teal)",
  backpack: "var(--viz-amber)",
  ondo: "var(--viz-violet)",
};

function compact(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function pct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Compact mover row used inside the smaller tiles. */
function Mover({ equity }: { equity: EquitySummary }) {
  const change = equity.priceChange24hPct;
  return (
    <Link href={`/markets/${equity.ticker}`} className="bento-mover">
      <EquityLogo logo={equity.logo} ticker={equity.ticker} size={22} />
      <b>{equity.ticker}</b>
      <span className={change === null ? "" : change >= 0 ? "up" : "down"}>
        {change !== null &&
          (change >= 0 ? (
            <ArrowUpRight size={11} />
          ) : (
            <ArrowDownRight size={11} />
          ))}
        {pct(change)}
      </span>
    </Link>
  );
}

export type BentoEvent = {
  id: string;
  ticker: string | null;
  companyName: string | null;
  companyLogo: string | null;
  label: string;
  date: string;
};

function eventDay(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
}

export function MarketsBento({
  overview,
  universe,
  multiIssuerCount,
  events,
  onOpenAll,
}: {
  overview: MarketsOverview;
  universe: Universe;
  multiIssuerCount: number;
  events: BentoEvent[];
  onOpenAll: () => void;
}) {
  const live = useMemo(
    () => overview.items.filter((item) => item.price !== null),
    [overview.items],
  );

  const byVolume = useMemo(
    () =>
      [...overview.items]
        .filter((item) => item.onchainVolume24hUsd !== null)
        .sort(
          (a, b) =>
            (b.onchainVolume24hUsd ?? 0) - (a.onchainVolume24hUsd ?? 0),
        ),
    [overview.items],
  );

  const gainers = useMemo(
    () =>
      [...live]
        .filter((i) => (i.priceChange24hPct ?? 0) > 0)
        .sort((a, b) => b.priceChange24hPct! - a.priceChange24hPct!)
        .slice(0, 3),
    [live],
  );

  const losers = useMemo(
    () =>
      [...live]
        .filter((i) => (i.priceChange24hPct ?? 0) < 0)
        .sort((a, b) => a.priceChange24hPct! - b.priceChange24hPct!)
        .slice(0, 3),
    [live],
  );

  const breadth = useMemo(() => {
    const priced = live.filter((i) => i.priceChange24hPct !== null);
    const advancing = priced.filter((i) => i.priceChange24hPct! > 0).length;
    const declining = priced.filter((i) => i.priceChange24hPct! < 0).length;
    return {
      advancing,
      declining,
      total: priced.length,
      share: priced.length ? (advancing / priced.length) * 100 : null,
    };
  }, [live]);

  // Where the traded volume actually sits, by issuer. Unlabelled bars of
  // anonymous companies told the reader nothing; this answers a real question.
  const split = useMemo(() => {
    const entries = Object.entries(overview.providerVolume ?? {}).filter(
      ([, v]) => v > 0,
    );
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (!total) return [];
    return entries
      .map(([provider, volume]) => ({
        provider,
        label: ISSUERS[provider] ?? provider,
        colour: ISSUER_COLOURS[provider] ?? "var(--text-4)",
        volume,
        share: (volume / total) * 100,
      }))
      .sort((a, b) => b.volume - a.volume);
  }, [overview.providerVolume]);

  return (
    <div className="bento">
      {/* Hero: the number that says the market is real, with its shape. */}
      <section className="bento-tile bento-volume">
        <header>
          <span>Tracked 24h volume</span>
        </header>
        <strong className="bento-figure">
          {compact(overview.totalVolume24hUsd)}
        </strong>
        <p>
          across {overview.matchedCompanyCount} companies with live onchain
          activity
        </p>
        {split.length ? (
          <div className="bento-split">
            <div className="bento-split-bar">
              {split.map((s) => (
                <i
                  key={s.provider}
                  style={{ width: `${s.share}%`, background: s.colour }}
                  title={`${s.label} ${compact(s.volume)}`}
                />
              ))}
            </div>
            <dl>
              {split.map((s) => (
                <div key={s.provider}>
                  <dt>
                    <i style={{ background: s.colour }} />
                    {s.label}
                  </dt>
                  <dd>{s.share.toFixed(0)}%</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>

      {/* Catalog scale, stacked so the two figures read as one claim. */}
      <section className="bento-tile bento-universe">
        <button type="button" onClick={onOpenAll}>
          <div>
            <span>Companies</span>
            <strong>{universe.companies.toLocaleString()}</strong>
          </div>
          <div>
            <span>Representations</span>
            <strong>{universe.representations.toLocaleString()}</strong>
          </div>
          <div>
            <span>All three issuers</span>
            <strong>{multiIssuerCount.toLocaleString()}</strong>
          </div>
        </button>
      </section>

      <section className="bento-tile bento-movers">
        <header>
          <span>Gainers</span>
        </header>
        {gainers.length ? (
          gainers.map((e) => <Mover key={e.id} equity={e} />)
        ) : (
          <p className="bento-empty">Unavailable</p>
        )}
      </section>

      <section className="bento-tile bento-movers">
        <header>
          <span>Losers</span>
        </header>
        {losers.length ? (
          losers.map((e) => <Mover key={e.id} equity={e} />)
        ) : (
          <p className="bento-empty">Unavailable</p>
        )}
      </section>

      {/* Most traded gets the tall tile: it is the list people scan. */}
      <section className="bento-tile bento-traded">
        <header>
          <span>Most traded</span>
        </header>
        {byVolume.length ? (
          <ol>
            {byVolume.slice(0, 6).map((equity, index) => (
              <li key={equity.id}>
                <Link href={`/markets/${equity.ticker}`}>
                  <em>{String(index + 1).padStart(2, "0")}</em>
                  <EquityLogo
                    logo={equity.logo}
                    ticker={equity.ticker}
                    size={24}
                  />
                  <span>
                    <b>{equity.ticker}</b>
                    <i>{equity.name}</i>
                  </span>
                  <u>{compact(equity.onchainVolume24hUsd)}</u>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="bento-empty">Unavailable</p>
        )}
      </section>

      {/* The grid had a hole here; recent filings fill it and lead to the
          calendar, which is otherwise buried behind a tab. */}
      <section className="bento-tile bento-events">
        <header>
          <span>Latest events</span>
        </header>
        {events.length ? (
          <>
            <ol>
              {events.slice(0, 4).map((event) => (
                <li key={event.id}>
                  <Link href={`/markets/${event.ticker}`}>
                    <EquityLogo
                      logo={event.companyLogo}
                      ticker={event.ticker ?? "?"}
                      size={20}
                    />
                    <b>{event.ticker}</b>
                    <u>{event.label}</u>
                    <i>{eventDay(event.date)}</i>
                  </Link>
                </li>
              ))}
            </ol>
            <Link className="bento-more" href="/markets/calendar">
              Calendar <ArrowUpRight size={13} />
            </Link>
          </>
        ) : (
          <p className="bento-empty">No filings in range</p>
        )}
      </section>

      <section className="bento-tile bento-breadth">
        <header>
          <span>Breadth</span>
          {/* The one piece of jargon on this page, and the denominator is not
              the catalog — so both are said rather than assumed. */}
          <InfoTip label="What breadth means">
            The share of companies that rose over the last 24 hours, counted
            across the{" "}
            {breadth.total ? breadth.total.toLocaleString() : ""} with a live
            onchain price rather than the whole catalog. A market can climb on a
            few large names while most of it falls, and breadth is what tells
            those apart.
          </InfoTip>
        </header>
        {breadth.share === null ? (
          <p className="bento-empty">Unavailable</p>
        ) : (
          <>
            <strong className="bento-figure bento-figure-sm">
              {Math.round(breadth.share)}%
            </strong>
            <p>advancing</p>
            <div className="bento-breadth-bar" aria-hidden>
              <i style={{ width: `${breadth.share}%` }} />
            </div>
            <dl>
              <div>
                <dt>Up</dt>
                <dd className="up">{breadth.advancing}</dd>
              </div>
              <div>
                <dt>Down</dt>
                <dd className="down">{breadth.declining}</dd>
              </div>
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
