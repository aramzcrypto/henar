"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { EquitySummary, MarketsOverview } from "@/lib/equities/types";
import styles from "@/app/landing.module.css";

const providerLogos = {
  xstocks: "/logos/issuers/xstocks.svg",
  backpack: "/logos/issuers/backpack.svg",
  ondo: "/logos/issuers/ondo.svg",
} as const;

function money(value: number | null, compact = false) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

export function LandingMarketPreview() {
  const [overview, setOverview] = useState<MarketsOverview | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/equities/overview", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: MarketsOverview | null) => setOverview(data))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const rows = overview?.items.slice(0, 3) ?? [];

  return (
    <div className={styles.marketBoard} aria-label="Live Solana stock market overview">
      <div className={styles.boardTop}>
        <div>
          <span className={styles.boardKicker}>Market overview</span>
          <strong>{money(overview?.totalVolume24hUsd ?? null, true)}</strong>
          <small>onchain volume · 24h</small>
        </div>
        <span className={styles.live}><i /> Live</span>
      </div>

      <div className={styles.marketChart} aria-hidden="true">
        <svg viewBox="0 0 680 120" preserveAspectRatio="none">
          <defs>
            <linearGradient id="market-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity=".2" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={styles.chartArea} d="M0,94 C48,87 72,92 113,75 C153,57 180,72 218,62 C260,50 273,75 319,52 C356,34 385,46 418,30 C451,14 474,44 516,29 C559,14 597,28 630,12 C650,4 664,11 680,3 L680,120 L0,120 Z" />
          <path className={styles.chartTrace} d="M0,94 C48,87 72,92 113,75 C153,57 180,72 218,62 C260,50 273,75 319,52 C356,34 385,46 418,30 C451,14 474,44 516,29 C559,14 597,28 630,12 C650,4 664,11 680,3" />
        </svg>
      </div>

      <div className={styles.marketRows}>
        <div className={styles.marketRowHead}>
          <span>Company</span><span>Issuers</span><span>Price</span><span>24h volume</span>
        </div>
        {rows.length > 0
          ? rows.map((row) => <MarketRow key={row.id} row={row} />)
          : [0, 1, 2].map((index) => <div className={styles.marketRowSkeleton} key={index} />)}
      </div>
    </div>
  );
}

function MarketRow({ row }: { row: EquitySummary }) {
  const change = row.priceChange24hPct;
  return (
    <div className={styles.marketRow}>
      <span className={styles.marketCompany}>
        {row.logo ? <Image src={row.logo} alt="" width={30} height={30} /> : <i>{row.ticker[0]}</i>}
        <span><strong>{row.ticker}</strong><small>{row.name}</small></span>
      </span>
      <span className={styles.issuerStack} aria-label={`${row.providers.length} issuers`}>
        {row.providers.map((provider) => (
          <Image key={provider} src={providerLogos[provider]} alt="" width={19} height={19} />
        ))}
      </span>
      <span className={styles.marketPrice}>
        <strong>{money(row.price)}</strong>
        <small className={change !== null && change < 0 ? styles.negative : styles.positive}>
          {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </small>
      </span>
      <span className={styles.marketVolume}>{money(row.onchainVolume24hUsd, true)}</span>
    </div>
  );
}
