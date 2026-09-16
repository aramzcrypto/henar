"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import { MarketsTabs } from "./markets-tabs";
import { dislocations, formatDeviation, markDeviation } from "@/lib/private-markets/analytics";
import { PRIVATE_PROVIDER_LABELS, type PrivateMarkets, type PrivateProvider } from "@/lib/private-markets/types";

function usd(value: number | string | null | undefined, compact = false) {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 2 : n < 10 ? 4 : 2 }).format(n);
}

function deviationClass(bps: number | null) {
  if (bps === null) return "value-muted";
  return bps >= 0 ? "positive" : "negative";
}

/**
 * Markets → Pre-IPO. Company-first: one row per private company, its exposure
 * products listed underneath with the provider that issues each. Provider
 * marks and executable prices are shown side by side and never conflated.
 */
export function PreIpoMarkets({ initial }: { initial: PrivateMarkets | null }) {
  const [provider, setProvider] = useState<"all" | PrivateProvider>("all");
  const companies = useMemo(() => {
    if (!initial) return [];
    return initial.companies
      .map((company) => ({ ...company, exposureProducts: company.exposureProducts.filter((p) => provider === "all" || p.provider === provider) }))
      .filter((company) => company.exposureProducts.length);
  }, [initial, provider]);
  const rows = useMemo(() => {
    if (!initial) return [];
    const names = new Map(initial.companies.map((c) => [c.id, c.name]));
    return dislocations(initial.products.filter((p) => provider === "all" || p.provider === provider), names);
  }, [initial, provider]);

  return (
    <section className="markets-shell">
      <div className="markets-controls">
        <MarketsTabs active="pre-ipo" />
      </div>
      <header className="preipo-header">
        <div>
          <h1>Pre-IPO</h1>
          <p>Private-market exposure on Solana. Provider data, verified onchain state and Henar&apos;s own routing, per product.</p>
        </div>
        <div className="asset-class-tabs preipo-filters" role="group" aria-label="Provider">
          {([["all", "All"], ["prestocks", "PreStocks"], ["tessera", "Tessera"]] as const).map(([value, label]) => (
            <button key={value} aria-pressed={provider === value} className={provider === value ? "active" : ""} onClick={() => setProvider(value)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {initial?.sources.some((s) => s.status === "unavailable") && (
        <p className="onchain-method">
          {initial.sources.filter((s) => s.status === "unavailable").map((s) => `${PRIVATE_PROVIDER_LABELS[s.provider]} is unavailable`).join(" · ")}. Its products are not listed rather than estimated.
        </p>
      )}

      {!initial ? (
        <p className="fin-empty">Pre-IPO markets are unavailable right now.</p>
      ) : !companies.length ? (
        <p className="fin-empty">No private-market products are available from this provider right now.</p>
      ) : (
        <>
          <div className="market-list preipo-list">
            <div className="market-list-head preipo-row">
              <span>Company</span>
              <span>Exposure products</span>
              <span>Provider mark valuation</span>
              <span>Executable price</span>
              <span>Premium / discount</span>
              <span>Liquidity</span>
              <span />
            </div>
            {companies.map((company) => (
              <Link className="market-row preipo-row" key={company.id} href={`/markets/pre-ipo/${company.slug}`}>
                <span className="market-company">
                  <EquityLogo logo={company.logo} ticker={company.name} size={38} plate />
                  <span>
                    <strong>{company.name}</strong>
                    <small>{company.sector ?? "Private company"}</small>
                  </span>
                </span>
                <span className="market-metric preipo-products">
                  {company.exposureProducts.map((p) => (
                    <i key={p.id} data-provider={p.provider}>
                      <b>{p.symbol}</b>
                      <span>{PRIVATE_PROVIDER_LABELS[p.provider]}</span>
                    </i>
                  ))}
                </span>
                <span className="market-metric">
                  {company.exposureProducts.map((p) => (
                    <em key={p.id}>{usd(p.mark?.valuation ?? null, true)}</em>
                  ))}
                </span>
                <span className="market-metric">
                  {company.exposureProducts.map((p) => (
                    <em key={p.id}>{p.execution?.status === "available" ? usd(p.execution.referenceUiPrice) : <small className="value-muted">{p.execution?.reason ?? "No verified route"}</small>}</em>
                  ))}
                </span>
                <span className="market-metric">
                  {company.exposureProducts.map((p) => {
                    const d = markDeviation(p);
                    return (
                      <em key={p.id} className={deviationClass(d.priceDeviationBps)}>
                        {d.priceDeviationBps === null ? "—" : formatDeviation(d.priceDeviationBps)}
                      </em>
                    );
                  })}
                </span>
                <span className="market-metric">
                  {company.exposureProducts.map((p) => {
                    const pools = p.liquidity?.verifiedPools.filter((x) => x.enabled) ?? [];
                    const tvl = pools.reduce<number | null>((sum, x) => (x.tvlUsd === null ? sum : (sum ?? 0) + x.tvlUsd), null);
                    return (
                      <em key={p.id}>
                        {tvl === null ? (p.execution?.status === "available" ? "Route verified" : "—") : usd(tvl, true)}
                        {pools.length ? <small> · {pools.length} pool{pools.length === 1 ? "" : "s"}</small> : null}
                      </em>
                    );
                  })}
                </span>
                <span className="market-row-arrow">
                  <ArrowRight size={15} />
                </span>
              </Link>
            ))}
          </div>

          <section className="preipo-dislocations">
            <header>
              <h2>Market dislocations</h2>
              <p>How the onchain market is pricing each exposure product relative to its provider&apos;s mark. A difference is not an arbitrage, and the market need not converge to the mark.</p>
            </header>
            <div className="market-list">
              <div className="market-list-head dislocation-row">
                <span>Product</span>
                <span>Provider</span>
                <span>Provider mark</span>
                <span>Executable reference</span>
                <span>Premium / discount</span>
                <span>Valuation premium</span>
                <span>Best route</span>
              </div>
              {rows.map((row) => (
                <div className="market-row dislocation-row" key={row.productId}>
                  <span className="market-company">
                    <span>
                      <strong>{row.symbol}</strong>
                      <small>{row.companyName}</small>
                    </span>
                  </span>
                  <span className="market-metric">{PRIVATE_PROVIDER_LABELS[row.provider]}</span>
                  <span className="market-metric">{usd(row.markPrice)}</span>
                  <span className="market-metric">
                    {usd(row.referencePrice)}
                    <small>{row.referenceSource === "henar-route" ? "Henar route" : row.referenceSource === "provider-token" ? "Provider token price" : "Unavailable"}</small>
                  </span>
                  <span className={`market-metric ${deviationClass(row.premiumBps)}`}>{row.premiumBps === null ? (row.reason ?? "—") : formatDeviation(row.premiumBps)}</span>
                  <span className={`market-metric ${deviationClass(row.valuationPremiumBps)}`}>{formatDeviation(row.valuationPremiumBps)}</span>
                  <span className="market-metric">{row.bestRoute ?? "No verified route"}</span>
                </div>
              ))}
            </div>
            <p className="onchain-method">
              Provider marks from {initial.sources.filter((s) => s.status === "available").map((s) => PRIVATE_PROVIDER_LABELS[s.provider]).join(" and ") || "no provider"} · Executable prices are live $1,000 Henar buy routes net of the Henar fee · Read {new Date(initial.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </section>
        </>
      )}
    </section>
  );
}
