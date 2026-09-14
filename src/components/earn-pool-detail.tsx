"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Info } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import { StatusTag } from "./earn-pools-page";
import { POOL_TYPE_LABELS, type EarnPool } from "@/lib/equities/earn/pools";

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

/**
 * Ticket for a pool Henar does not route deposits into yet. It mirrors the live
 * strategy's controls so the shape of the product is visible, and every control
 * is inert and labelled as such rather than pretending to transact.
 */
function PreviewTicket({ pool }: { pool: EarnPool }) {
  const [action, setAction] = useState<"Deposit" | "Withdraw">("Deposit");
  return (
    <aside className="pool-ticket" aria-label={`${pool.name} ticket`}>
      <div className="pool-ticket-head">
        <div className="product-segments">
          {(["Deposit", "Withdraw"] as const).map((next) => (
            <button
              key={next}
              aria-pressed={action === next}
              onClick={() => setAction(next)}
            >
              {next}
            </button>
          ))}
        </div>
      </div>

      <label className="pool-amount">
        {action} amount
        <div>
          <input
            inputMode="decimal"
            placeholder="0.00"
            disabled
            aria-label={`${action} ${pool.depositAsset} amount`}
          />
          <span>{pool.depositAsset}</span>
        </div>
        <small>
          Wallet balance <span>—</span>
        </small>
      </label>

      <dl className="pool-ticket-facts">
        <div>
          <dt>Variable APY</dt>
          <dd>{percent(pool.apy)}</dd>
        </div>
        <div>
          <dt>Pool TVL</dt>
          <dd>{usd(pool.tvlUsd)}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>{pool.protocol}</dd>
        </div>
      </dl>

      <button className="pool-ticket-cta" disabled>
        Coming soon
      </button>
      <p className="pool-ticket-note">
        <Info size={13} />
        <span>
          Henar reads this market live but does not route deposits into it yet.
          The controls above are a preview of the integration being built.
        </span>
      </p>
      {pool.externalUrl ? (
        <a
          className="pool-ticket-external"
          href={pool.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open on {pool.protocol} <ArrowUpRight size={13} />
        </a>
      ) : null}
    </aside>
  );
}

export function EarnPoolDetail({ pool }: { pool: EarnPool }) {
  return (
    <div className="pool-detail">
      <Link href="/earn" className="back-markets">
        <ArrowLeft size={15} /> Earn
      </Link>

      <header className="pool-header">
        <div className="pool-identity">
          {pool.ticker ? (
            <EquityLogo
              logo={pool.companyLogo}
              ticker={pool.ticker}
              size={48}
              priority
            />
          ) : null}
          <div>
            <span>
              {POOL_TYPE_LABELS[pool.type]} · {pool.protocol}
            </span>
            <h1>{pool.company ? `${pool.company}` : pool.name}</h1>
            <p>{pool.summary}</p>
          </div>
          <StatusTag status={pool.status} />
        </div>
      </header>

      <div className="pool-body">
        <section className="pool-facts">
          <dl className="company-keystats">
            <div>
              <dt>Variable APY</dt>
              <dd className={pool.apy === null ? "value-muted" : undefined}>
                {percent(pool.apy)}
              </dd>
            </div>
            <div>
              <dt>TVL</dt>
              <dd className={pool.tvlUsd === null ? "value-muted" : undefined}>
                {usd(pool.tvlUsd)}
              </dd>
            </div>
            <div>
              <dt>Deposit asset</dt>
              <dd>{pool.depositAsset}</dd>
            </div>
            <div>
              <dt>Issuer</dt>
              <dd>
                {pool.provider
                  ? (PROVIDER_LABELS[pool.provider] ?? pool.provider)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Your deposit</dt>
              <dd className="value-muted">—</dd>
            </div>
          </dl>

          <article className="pool-about">
            <span>ABOUT THIS POOL</span>
            <h2>How it works</h2>
            <p>
              {pool.ticker
                ? `Depositors supply ${pool.representation}, the ${PROVIDER_LABELS[pool.provider ?? ""] ?? "issuer"} representation of ${pool.company}, into the ${pool.protocol} ${POOL_TYPE_LABELS[pool.type].toLowerCase()} market. Borrowers pay interest on that supply, which accrues to depositors as a variable rate.`
                : pool.summary}
            </p>
            <p>
              Holding a tokenized representation is not the same as holding the
              underlying share, and supplying it to a lending market adds the
              protocol&apos;s own risk on top. Rates are variable and not
              guaranteed.
            </p>
            {pool.ticker ? (
              <Link className="pool-about-link" href={`/markets/${pool.ticker}`}>
                View {pool.ticker} on Markets <ArrowUpRight size={13} />
              </Link>
            ) : null}
          </article>
        </section>

        <PreviewTicket pool={pool} />
      </div>
    </div>
  );
}
