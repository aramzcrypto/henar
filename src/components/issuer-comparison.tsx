"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type {
  IssuerCatalog,
  IssuerMarket,
  IssuerOnchainPresence,
  IssuerProfile,
} from "@/lib/issuers/types";

type Row = {
  profile: IssuerProfile;
  catalog: IssuerCatalog;
  presence: IssuerOnchainPresence;
  market: IssuerMarket;
};
type Payload = { issuers: Row[]; generatedAt: string };

function usd(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

/* A minimum width keeps a small-but-real bar visible next to a large one.
   Zero gets no bar at all: a sliver where nothing traded reads as something. */
function share(value: number | null, max: number) {
  if (value === null || max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/**
 * Issuers side by side on the one axis that decides whether a token is
 * usable: what trades, and what depth is behind it.
 *
 * Both figures are reported against the mints they were measured over,
 * because the counts are the story. An issuer with a thousand mints and fifty
 * live markets is a different product from an issuer with fifty of each, and
 * a total alone hides exactly that.
 *
 * Fetched after paint rather than server-rendered: the read covers the whole
 * catalog, and the overview should not wait on it. The first read always
 * runs — only the refresh would be worth pausing.
 */
export function IssuerComparison() {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/markets/issuers", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (controller.signal.aborted) return;
        setData(payload);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    })();
    return () => controller.abort();
  }, []);

  if (state === "error") return null;

  const rows = data?.issuers ?? [];
  const maxVolume = Math.max(0, ...rows.map((row) => row.market.volume24hUsd ?? 0));
  const maxLiquidity = Math.max(0, ...rows.map((row) => row.market.liquidityUsd ?? 0));

  return (
    <section className="issuer-compare">
      <header>
        <div>
          <strong>Issuers on Solana</strong>
          <small>
            What each issuer has actually issued on Solana, and what trades on
            top of it. Select one for its profile.
          </small>
        </div>
      </header>
      {state === "loading" ? (
        <div className="issuer-compare-pending" aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="issuer-compare-grid">
          <div className="issuer-compare-head">
            <span>Issuer</span>
            <span>24h volume</span>
            <span>Liquidity</span>
            <span>Live markets</span>
            <span>Holders</span>
            <span />
          </div>
          {rows.map(({ profile, catalog, presence, market }) => (
            <Link key={profile.id} href={`/markets/issuers/${profile.id}`} className="issuer-compare-row">
              <span className="issuer-compare-name">
                <Image src={profile.logo} alt="" width={22} height={22} />
                <span>
                  <strong>{profile.label}</strong>
                  {/* Registered alone invites the wrong comparison: Backpack
                      publishes the most mints and has issued the fewest. */}
                  <small>
                    {presence.live === null
                      ? `${catalog.representations.toLocaleString()} mints`
                      : `${presence.live.toLocaleString()} of ${catalog.representations.toLocaleString()} issued`}
                  </small>
                </span>
              </span>
              {/* The caption is carried on every row and hidden where the
                  column header is visible, so a narrow layout that drops the
                  header never leaves a number without its name. */}
              <span className="issuer-compare-metric">
                <b>{usd(market.volume24hUsd)}</b>
                <small>24h volume</small>
                <i style={{ width: `${share(market.volume24hUsd, maxVolume)}%` }} data-kind="volume" />
              </span>
              <span className="issuer-compare-metric">
                <b>{usd(market.liquidityUsd)}</b>
                <small>Liquidity</small>
                <i style={{ width: `${share(market.liquidityUsd, maxLiquidity)}%` }} data-kind="liquidity" />
              </span>
              <span className="issuer-compare-count">
                <b>{market.tradedMints.toLocaleString()}</b>
                <small>of {market.mintsQueried.toLocaleString()} traded</small>
              </span>
              <span className="issuer-compare-count">
                <b>{market.holders === null ? "—" : market.holders.toLocaleString()}</b>
                <small>token holders</small>
              </span>
              <ArrowUpRight className="issuer-compare-arrow" size={15} />
            </Link>
          ))}
        </div>
      )}
      <p className="issuer-compare-note">
        Issued counts mints holding supply on mainnet: a registered mint is an
        address, not a token. Liquidity is pooled depth on Solana AMMs, so an
        issuer whose tokens are held rather than traded reads low here without
        being small.
      </p>
    </section>
  );
}
