"use client";

import { useMemo, useState } from "react";
import { rateIsStrategyReturn, type DepositAvailability } from "@/lib/strategies/presentation";
import type { PoolStats } from "@/lib/strategies/pool-stats";
import type { StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";

const QUICK = [100, 500, 1_000];

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/**
 * The deposit ticket.
 *
 * It is the real ticket shape, priced off the pool's real current rate, with
 * one thing missing: a deposit path. The button says so rather than pretending
 * a disabled control is a temporary state of an otherwise working form.
 *
 * Every projection is arithmetic on a published rate over a stated window,
 * shown as what it is. Nothing is forecast.
 */
export function StrategyTicket({
  definition,
  instance,
  stats,
  deposits,
}: {
  definition: StrategyDefinition;
  instance: StrategyInstance;
  stats: PoolStats | null;
  deposits: DepositAvailability;
}) {
  const [amount, setAmount] = useState("");
  const parsed = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [amount]);

  /* Only a rate the strategy actually earns. An accumulation strategy sits
     on an LP pool without collecting its fees. */
  const rate = rateIsStrategyReturn(instance.strategyType) ? (stats?.rate ?? null) : null;
  /* A year of the current rate, on the amount entered. It is the rate's own
     arithmetic, not a forecast, and it is labelled with the rate's window. */
  const projected = parsed !== null && rate ? (parsed * rate.value) / 100 : null;

  const isAccumulate = instance.strategyType === "SMART_ACCUMULATE";
  const isRange = instance.strategyType === "RANGE_YIELD";

  return (
    <aside className="earn-ticket strategy-ticket" aria-label={`${instance.name} deposit`}>
      <div className="ticket-toolbar">
        <h2>Deposit</h2>
        <span className="chain-indicator">Solana</span>
      </div>

      <div className="ticket-panel pay-panel">
        <div className="panel-label">
          <span>Amount</span>
          <span className="issuer-label">{definition.deposits}</span>
        </div>
        <div className="ticket-amount">
          <input
            aria-label="Deposit amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
          />
          <span className="token-chip static">{isRange ? `${instance.market.assetSymbol} + USDC` : instance.market.quoteSymbol}</span>
        </div>
        <div className="quick-amounts">
          {QUICK.map((value) => (
            <button key={value} type="button" onClick={() => setAmount(String(value))}>
              ${value.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <div className="ticket-rows">
        {rate && (
          <Row label={rate.label}>
            {rate.value.toFixed(2)}% <small className="ticket-source">{rate.source} · {rate.window}</small>
          </Row>
        )}

        {isAccumulate ? (
          <>
            <Row label="Buys between">
              {instance.state.kind === "SMART_ACCUMULATE" && instance.state.levels.length
                ? `${money(Number(instance.state.levels[instance.state.levels.length - 1].price))} and ${money(Number(instance.state.levels[0].price))}`
                : "—"}
            </Row>
            <Row label="If price never falls">Your USDC stays USDC</Row>
          </>
        ) : isRange ? (
          <>
            <Row label="Range">
              {instance.state.kind === "RANGE_YIELD" ? `${money(Number(instance.state.lowerPrice))} – ${money(Number(instance.state.upperPrice))}` : "—"}
            </Row>
            {projected !== null && <Row label="At that rate">{money(projected)} a year</Row>}
          </>
        ) : (
          <>
            {projected !== null && <Row label="At that rate">{money(projected)} a year</Row>}
            <Row label="Principal">Stays in USDC</Row>
          </>
        )}

        <Row label="Henar fee">0%</Row>
      </div>

      <button className="primary strategy-deposit" disabled aria-disabled="true">
        {deposits.label}
      </button>
      <p className="strategy-ticket-note">{deposits.note}</p>
    </aside>
  );
}
