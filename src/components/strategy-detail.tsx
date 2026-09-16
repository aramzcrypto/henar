"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ComingSoonTag, usd } from "./earn-page";
import { StrategyTicket } from "./strategy-ticket";
import { rateIsStrategyReturn, type DepositAvailability } from "@/lib/strategies/presentation";
import type { PoolStats } from "@/lib/strategies/pool-stats";
import type { MarketAdmission, MarketCandidate } from "@/lib/strategies/markets";
import type { StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";

type MarketReport = { candidate: MarketCandidate; admission: MarketAdmission }[];

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function units(raw: string | null | undefined, decimals: number, places = 4) {
  if (raw === null || raw === undefined) return null;
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: places }) : null;
}
function price(value: string | null | undefined) {
  if (!value) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 })}` : "—";
}

/** A compact label/value pair, used everywhere numbers are listed. */
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="strategy-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one picture each pool gets.
 *
 * A strategy is easier to understand from its shape than from a paragraph
 * about it, so each gets a single diagram and the prose stays short.
 */
function PoolVisual({ instance }: { instance: StrategyInstance }) {
  const state = instance.state;

  if (state.kind === "EARN_STOCKS")
    return (
      <div className="flow">
        <span className="flow-step">
          <b>USDC</b>
          <small>stays put</small>
        </span>
        <i />
        <span className="flow-step">
          <b>Interest</b>
          <small>{state.currentSupplyApy === null ? "on Kamino" : `${state.currentSupplyApy.toFixed(2)}% on Kamino`}</small>
        </span>
        <i />
        <span className="flow-step accent">
          <b>{state.targetStockSymbol}</b>
          <small>bought with it</small>
        </span>
      </div>
    );

  if (state.kind === "SMART_ACCUMULATE") {
    if (!state.levels.length) return <p className="fin-empty">No price reference is available.</p>;
    const max = Math.max(...state.levels.map((l) => Number(l.allocated)), 1);
    return (
      <div className="ladder">
        {state.currentReference && (
          <div className="ladder-now">
            <span>Now</span>
            <strong>{price(state.currentReference)}</strong>
          </div>
        )}
        <div className="ladder-levels">
          {state.levels.map((level) => (
            <div className={`ladder-level ${level.status}`} key={level.index}>
              <span className="ladder-price">{price(level.price)}</span>
              <span className="ladder-bar">
                <i style={{ width: `${Math.max((Number(level.allocated) / max) * 100, 6)}%` }} />
              </span>
              <span className="ladder-alloc">{usd(Number(level.allocated) / 1e6, false)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const lower = Number(state.lowerPrice);
  const upper = Number(state.upperPrice);
  const current = state.currentPrice ? Number(state.currentPrice) : null;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return <p className="fin-empty">No range is set yet.</p>;
  const pad = (upper - lower) * 0.35;
  const from = lower - pad;
  const to = upper + pad;
  const pct = (value: number) => Math.min(Math.max(((value - from) / (to - from)) * 100, 0), 100);
  return (
    <div className="range-bar">
      <div className="range-track">
        <span className="range-active" style={{ left: `${pct(lower)}%`, width: `${pct(upper) - pct(lower)}%` }} />
        {current !== null && <i className="range-current" style={{ left: `${pct(current)}%` }} />}
      </div>
      <div className="range-labels">
        <span>{price(state.lowerPrice)}</span>
        <span className={state.inRange === false ? "negative" : state.inRange ? "positive" : "value-muted"}>
          {state.inRange === null ? "Range status unknown" : state.inRange ? `In range · now ${price(state.currentPrice)}` : `Out of range · now ${price(state.currentPrice)}`}
        </span>
        <span>{price(state.upperPrice)}</span>
      </div>
    </div>
  );
}

export function StrategyDetail({
  definition,
  instance,
  markets,
  stats,
  deposits,
}: {
  definition: StrategyDefinition;
  instance: StrategyInstance;
  markets: MarketReport;
  stats: PoolStats | null;
  deposits: DepositAvailability;
}) {
  const market = markets.find((m) => m.candidate.address === instance.market.address) ?? null;
  const poolRate = stats?.rate ?? null;
  /* The headline states the strategy's own return. A pool statistic the
     strategy does not collect belongs further down, not beside its name. */
  const rate = rateIsStrategyReturn(instance.strategyType) ? poolRate : null;
  const headlinePrice = instance.state.kind === "SMART_ACCUMULATE" ? instance.state.currentReference : null;
  const state = instance.state;

  return (
    <section className="strategy-detail">
      <header className="strategy-header">
        <div>
          <span className="strategy-eyebrow">
            {definition.protocols[0]} <ComingSoonTag label={deposits.label} />
          </span>
          <h1>{instance.name}</h1>
          <p>{definition.summary}</p>
        </div>
        <dl className="strategy-header-facts">
          <div>
            <dt>{rate ? rate.label : headlinePrice ? `${instance.market.assetSymbol} price` : "Rate"}</dt>
            <dd>{rate ? `${rate.value.toFixed(2)}%` : headlinePrice ? price(headlinePrice) : <span className="value-muted">—</span>}</dd>
          </div>
          <div>
            <dt>Pool size</dt>
            <dd>{usd(stats?.liquidityUsd)}</dd>
          </div>
          <div>
            <dt>Deposit</dt>
            <dd>{definition.deposits}</dd>
          </div>
        </dl>
      </header>

      <div className="strategy-desk">
        <div className="strategy-main">
          <article className="strategy-visual">
            <PoolVisual instance={instance} />
          </article>

          <article>
            <h2>How it works</h2>
            <p className="strategy-prose">{definition.returnSource.replace(/\.$/, "")}.</p>
            <ul className="strategy-risks">
              {definition.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </article>

          {/* Everything a judge or an engineer needs to check the claims,
              out of the way of everyone else. */}
          <details className="strategy-more">
            <summary>Pool and position details</summary>
            <div className="strategy-more-body">
              <Facts
                rows={[
                  ["Market", stats?.pair ?? instance.market.quoteSymbol],
                  [poolRate ? `${poolRate.label} · ${poolRate.window}` : "Rate", poolRate ? `${poolRate.value.toFixed(2)}% · ${poolRate.source}` : <span className="value-muted">Unavailable</span>],
                  ...(stats?.fees24hUsd !== null && stats?.fees24hUsd !== undefined ? ([["Pool fees · 24h", usd(stats.fees24hUsd, false)]] as [string, React.ReactNode][]) : []),
                  ...(stats?.baseFeePct !== null && stats?.baseFeePct !== undefined ? ([["Swap fee", `${stats.baseFeePct}%`]] as [string, React.ReactNode][]) : []),
                  ...(stats?.utilization !== null && stats?.utilization !== undefined ? ([["Utilization", `${Math.round(stats.utilization * 100)}%`]] as [string, React.ReactNode][]) : []),
                  ...(state.kind === "EARN_STOCKS"
                    ? ([
                        ["Principal", state.principalDeposited === "0" ? "Not funded" : usd(Number(state.principalDeposited) / 1e6, false)],
                        ["Yield accrued", state.grossYieldAccrued === null ? <span className="value-muted">Not measurable yet</span> : usd(Number(state.grossYieldAccrued) / 1e6, false)],
                        [`${state.targetStockSymbol} accumulated`, state.stockAccumulated === "0" ? "None yet" : (units(state.stockAccumulated, 8) ?? "—")],
                      ] as [string, React.ReactNode][])
                    : []),
                  ...(state.kind === "SMART_ACCUMULATE"
                    ? ([
                        ["Levels filled", `${state.levelsFilled} of ${state.levels.length}`],
                        ["Stock acquired", state.stockAcquired === null ? <span className="value-muted">None yet</span> : (units(state.stockAcquired, 8) ?? "—")],
                        ["Average price", state.averageAcquisitionPrice ? price(state.averageAcquisitionPrice) : <span className="value-muted">No fills yet</span>],
                      ] as [string, React.ReactNode][])
                    : []),
                  ...(state.kind === "RANGE_YIELD"
                    ? ([
                        ["Position value", state.positionValueQuote === null ? <span className="value-muted">Not funded</span> : usd(Number(state.positionValueQuote) / 1e6, false)],
                        ["Fees earned", state.feesUnclaimed ? `${units(state.feesUnclaimed.quote, 6) ?? "0"} USDC` : <span className="value-muted">—</span>],
                        ["Fee APR", state.feeApr === null ? <span className="value-muted">Insufficient history</span> : `${state.feeApr.value.toFixed(2)}%`],
                      ] as [string, React.ReactNode][])
                    : []),
                  ["Owner", instance.authority.owner === "not deployed" ? <span className="value-muted">Not funded</span> : short(instance.authority.owner)],
                  ["Operator can take principal", <span key="o" className="positive">No</span>],
                  [
                    "Pool",
                    <a key="p" href={`https://solscan.io/account/${instance.market.address}`} target="_blank" rel="noreferrer">
                      {short(instance.market.address)} <ExternalLink size={11} />
                    </a>,
                  ],
                  ["Henar fee", "0% during preview"],
                  ["Audit", "Not audited"],
                ]}
              />
              {market && <p className="onchain-method">{(market.admission.admitted ? market.admission.reasons : market.admission.failures).join(" · ")}</p>}
              <p className="onchain-method">{instance.authority.notes[0]}</p>
            </div>
          </details>
        </div>

        <StrategyTicket definition={definition} instance={instance} stats={stats} deposits={deposits} />
      </div>

      <p className="onchain-method earn-footnote">
        {[...new Set([...instance.provenance.map((p) => p.source), ...(stats?.provenance ? [stats.provenance.source] : [])])].join(" · ")} · Experimental and not audited · Henar capital only ·{" "}
        <Link href="/earn">All pools</Link>
      </p>
    </section>
  );
}
