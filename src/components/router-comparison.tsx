"use client";

/**
 * Henar Router comparison panel (Task 24). Rendered only when
 * NEXT_PUBLIC_HENAR_ROUTER_UI=1; the server route additionally requires
 * HENAR_ROUTER_QUOTES + HENAR_ROUTER_UI. Display only: the production Trade
 * button still executes through /api/market. Every quote is labelled with
 * its guard verdict and LIVE_VALIDATION_PENDING status.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { parseUnits, formatUnits } from "@/lib/amount";

type RouterQuote = {
  quoteId: string;
  issuer: string;
  expectedOutput: string | null;
  netUserOutput: string | null;
  minOutput: string | null;
  effectivePrice: string | null;
  priceImpactBps: number | null;
  route: { venue: string; poolAddress: string | null; percentBps: number }[] | null;
  alternatives: { venue: string; netOutput: string; priceImpactBps: number | null; approved: boolean; reason: string | null }[];
  exclusions: { venue: string; reason: string; detail: string | null }[];
  executionProtection: { mode: string; slippageBps: number | null; checks: { name: string; ok: boolean; detail: string }[] } | null;
  unavailableReason: string | null;
  liveValidation: string;
};

const VENUE_LABEL: Record<string, string> = {
  jupiter: "Jupiter",
  raydium: "Raydium CLMM",
  meteora: "Meteora DLMM",
  "meteora-dbc": "Meteora DBC",
  "meteora-damm-v2": "Meteora DAMM v2",
};

export function RouterComparison({
  mint,
  side,
  amountUi,
  inputDecimals,
  outputDecimals,
  outputSymbol,
}: {
  mint: string;
  side: "buy" | "sell" | null;
  amountUi: string;
  inputDecimals: number;
  outputDecimals: number;
  outputSymbol: string;
}) {
  const [quote, setQuote] = useState<RouterQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const enabled = process.env.NEXT_PUBLIC_HENAR_ROUTER_UI === "1";

  useEffect(() => {
    if (!enabled || !side) return;
    let amount: bigint;
    try {
      amount = parseUnits(amountUi, inputDecimals);
    } catch {
      return;
    }
    if (amount <= 0n) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/router/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, side, amount: amount.toString() }),
        signal: c.signal,
      })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
          setQuote(body);
          setError(null);
        })
        .catch((e) => {
          if (!c.signal.aborted) {
            setQuote(null);
            setError(e.message);
          }
        });
    }, 400);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [enabled, mint, side, amountUi, inputDecimals]);

  if (!enabled || !side) return null;
  const best = quote?.route?.[0] ?? null;
  const net = quote?.netUserOutput ? formatUnits(quote.netUserOutput, outputDecimals, 6) : null;
  const mode = quote?.executionProtection?.mode ?? null;

  return (
    <section className="router-compare" aria-label="Henar Router comparison">
      <header>
        <span>Henar Router</span>
        <em>comparison only · live validation pending</em>
      </header>
      {error ? (
        <p className="router-compare-empty">{error}</p>
      ) : !quote ? (
        <p className="router-compare-empty">Quoting…</p>
      ) : (
        <>
          <div className="router-compare-main">
            <div>
              <b>{best ? (VENUE_LABEL[best.venue] ?? best.venue) : "No route"}</b>
              <i>{quote.unavailableReason ? quote.unavailableReason : mode === "execute" ? "executable" : mode === "quote-only" ? "quote only" : "refused by guard"}</i>
            </div>
            <div>
              <b>{net ? `${net} ${outputSymbol}` : "—"}</b>
              <i>
                {quote.priceImpactBps !== null ? `${(quote.priceImpactBps / 100).toFixed(2)}% impact` : ""}
                {quote.executionProtection?.slippageBps !== null && quote.executionProtection?.slippageBps !== undefined ? ` · ${quote.executionProtection.slippageBps} bps slippage` : ""}
              </i>
            </div>
          </div>
          <button type="button" className="router-compare-toggle" onClick={() => setOpen((v) => !v)}>
            Route details {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {open && (
            <div className="router-compare-details">
              {quote.alternatives.map((a) => (
                <div key={a.venue}>
                  <span>{VENUE_LABEL[a.venue] ?? a.venue}</span>
                  <span>{formatUnits(a.netOutput, outputDecimals, 6)}</span>
                  <span>{a.approved ? "approved" : (a.reason ?? "refused")}</span>
                </div>
              ))}
              {quote.exclusions.map((x) => (
                <div key={x.venue} className="muted">
                  <span>{VENUE_LABEL[x.venue] ?? x.venue}</span>
                  <span>—</span>
                  <span>{x.reason}</span>
                </div>
              ))}
              {quote.executionProtection?.checks.filter((c) => !c.ok).map((c) => (
                <div key={c.name} className="muted">
                  <span>{c.name}</span>
                  <span />
                  <span>{c.detail}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
