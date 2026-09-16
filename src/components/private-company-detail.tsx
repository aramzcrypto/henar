"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import { markDeviation, formatDeviation } from "@/lib/private-markets/analytics";
import { STRUCTURE, PROVIDER_DOCS } from "@/lib/private-markets/structure";
import { PRIVATE_PROVIDER_LABELS, type PrivateCompany, type PrivateExposureProduct, type ProviderSourceStatus } from "@/lib/private-markets/types";

const SECTIONS = ["Overview", "Exposure Products", "Market Data", "Liquidity", "Onchain", "About"] as const;
type Section = (typeof SECTIONS)[number];

function usd(value: number | string | null | undefined, compact = false) {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 2 : n < 10 ? 4 : 2 }).format(n);
}
const count = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** Facts compared across providers. Presented side by side; never ranked. */
const COMPARISON: { label: string; value: (p: PrivateExposureProduct) => React.ReactNode }[] = [
  { label: "Product", value: (p) => <strong>{p.symbol}</strong> },
  { label: "Structure", value: (p) => p.structure.type },
  { label: "Provider mark", value: (p) => usd(p.mark?.price ?? null) },
  { label: "Provider valuation", value: (p) => usd(p.mark?.valuation ?? null, true) },
  { label: "Executable price", value: (p) => (p.execution?.status === "available" ? usd(p.execution.referenceUiPrice) : <span className="value-muted">{p.execution?.reason ?? "No verified route"}</span>) },
  {
    label: "Premium / discount",
    value: (p) => {
      const d = markDeviation(p);
      return <span className={d.priceDeviationBps === null ? "value-muted" : d.priceDeviationBps >= 0 ? "positive" : "negative"}>{d.priceDeviationBps === null ? (d.reason ?? "—") : formatDeviation(d.priceDeviationBps)}</span>;
    },
  },
  { label: "Supply", value: (p) => (p.onchain?.supplyUi ? Number(p.onchain.supplyUi).toLocaleString("en-US", { maximumFractionDigits: 2 }) : p.providerToken?.supply !== undefined ? p.providerToken.supply.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—") },
  { label: "Holders", value: (p) => (p.holders === null ? <span className="value-muted">Not published</span> : count(p.holders)) },
  { label: "Token program", value: (p) => (p.onchain?.tokenProgram ? (p.onchain.isToken2022 ? "Token-2022" : "Token") : "—") },
  { label: "Transfer fee", value: (p) => (p.onchain?.transferFeeBps === null || p.onchain?.transferFeeBps === undefined ? "—" : `${(p.onchain.transferFeeBps / 100).toFixed(2)}%`) },
  { label: "Verified liquidity", value: (p) => { const pools = p.liquidity?.verifiedPools.filter((x) => x.enabled) ?? []; const tvl = pools.reduce<number | null>((s, x) => (x.tvlUsd === null ? s : (s ?? 0) + x.tvlUsd), null); return pools.length ? `${usd(tvl, true)} · ${pools.length} pool${pools.length === 1 ? "" : "s"}` : <span className="value-muted">No enabled pool</span>; } },
  { label: "Best route", value: (p) => p.execution?.bestRoute ?? <span className="value-muted">Unavailable</span> },
  { label: "$1k price impact", value: (p) => { const d = p.liquidity?.depth.find((x) => x.notionalUsd === 1_000 && x.side === "buy"); return d?.priceImpactPct ? `${(Number(d.priceImpactPct) * 100).toFixed(3)}%` : <span className="value-muted">—</span>; } },
];

export function PrivateCompanyDetail({ company, sources, generatedAt }: { company: PrivateCompany; sources: ProviderSourceStatus[]; generatedAt: string }) {
  const [section, setSection] = useState<Section>("Exposure Products");
  const products = company.exposureProducts;
  return (
    <section className="market-detail">
      <header className="company-header">
        <div className="company-identity">
          <EquityLogo logo={company.logo} ticker={company.name} size={56} priority plate />
          <div>
            <span>PRIVATE COMPANY{company.sector ? ` · ${company.sector}` : ""}</span>
            <h1>{company.name}</h1>
            <p>
              {products.length} exposure product{products.length === 1 ? "" : "s"} · {company.providers.map((p) => PRIVATE_PROVIDER_LABELS[p]).join(" · ")}
            </p>
          </div>
        </div>
        <div className="company-header-side">
          <dl className="company-header-stats">
            {products.map((p) => (
              <div key={p.id}>
                <dt>{p.symbol}</dt>
                <dd>{p.execution?.status === "available" ? usd(p.execution.referenceUiPrice) : usd(p.mark?.price ?? null)}</dd>
              </div>
            ))}
          </dl>
          <Link className="company-trade" href={`/trade?stock=${products[0]?.mint ?? ""}`}>
            Trade {products[0]?.symbol ?? company.name}
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>

      <div className="company-context">
        <div>
          <span>Exposure type</span>
          <strong>Private-market exposure product</strong>
        </div>
        <div>
          <span>Solana</span>
          <strong>
            {products.filter((p) => p.onchain?.status === "verified").length} of {products.length} mint{products.length === 1 ? "" : "s"} verified onchain
          </strong>
        </div>
        <div className="company-context-issuers">
          <span>Providers</span>
          <div>
            {company.providers.map((provider) => (
              <em key={provider}>{PRIVATE_PROVIDER_LABELS[provider]}</em>
            ))}
          </div>
        </div>
      </div>

      <nav className="company-tabs" aria-label={`${company.name} sections`}>
        {SECTIONS.map((item) => (
          <button key={item} className={section === item ? "active" : ""} aria-pressed={section === item} onClick={() => setSection(item)}>
            {item}
          </button>
        ))}
      </nav>

      {section === "Overview" && (
        <div className="company-overview">
          <div className="company-overview-grid">
            <article>
              <span>COMPANY</span>
              <h2>{company.name}</h2>
              <p className="preipo-prose">{company.description ?? "No provider-published company description is available."}</p>
            </article>
            <article>
              <span>EXPOSURE PRODUCTS</span>
              <h2>
                {products.length} product{products.length === 1 ? "" : "s"} across {company.providers.length} provider{company.providers.length === 1 ? "" : "s"}
              </h2>
              <div className="company-issuer-list">
                {products.map((p) => (
                  <div key={p.id}>
                    <span>
                      <strong>{PRIVATE_PROVIDER_LABELS[p.provider]}</strong>
                    </span>
                    <b>{p.symbol}</b>
                  </div>
                ))}
              </div>
              <p className="preipo-prose">
                Products that reference the same company are not interchangeable. Each is a specific provider&apos;s product with its own mint, structure and terms, and Henar routes exactly the one you select.
              </p>
            </article>
          </div>
        </div>
      )}

      {section === "Exposure Products" && (
        <div className="preipo-comparison">
          <div className="preipo-comparison-grid" style={{ ["--products" as string]: String(products.length) }}>
            <div className="preipo-comparison-head">
              <span />
              {products.map((p) => (
                <span key={p.id}>
                  <strong>{PRIVATE_PROVIDER_LABELS[p.provider]}</strong>
                  <small>{p.symbol}</small>
                </span>
              ))}
            </div>
            {COMPARISON.map((row) => (
              <div className="preipo-comparison-row" key={row.label}>
                <span className="preipo-comparison-label">{row.label}</span>
                {products.map((p) => (
                  <span key={p.id}>{row.value(p)}</span>
                ))}
              </div>
            ))}
          </div>
          <p className="onchain-method">Factual differences only. Henar does not name a best provider or recommend a product.</p>
          {products.map((p) => (
            <details className="execution-details" key={p.id}>
              <summary>
                How {p.symbol} exposure works · {PRIVATE_PROVIDER_LABELS[p.provider]}
              </summary>
              <div className="preipo-structure">
                <p className="preipo-prose">{p.structure.description}</p>
                <ul>
                  {STRUCTURE[p.provider].howItWorks.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {p.eligibility && <p className="preipo-prose preipo-eligibility">{p.eligibility.note}</p>}
                <p className="onchain-method">
                  Source: {p.structure.attribution} ·{" "}
                  <a href={p.structure.sourceUrl} target="_blank" rel="noreferrer">
                    {p.structure.sourceUrl.replace(/^https:\/\//, "")} <ExternalLink size={11} />
                  </a>
                  {PROVIDER_DOCS[p.provider].terms ? (
                    <>
                      {" · "}
                      <a href={PROVIDER_DOCS[p.provider].terms!} target="_blank" rel="noreferrer">
                        Terms
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            </details>
          ))}
        </div>
      )}

      {section === "Market Data" && (
        <div className="preipo-panels">
          {products.map((p) => (
            <article key={p.id}>
              <header>
                <h3>
                  {p.symbol} <small>{PRIVATE_PROVIDER_LABELS[p.provider]}</small>
                </h3>
              </header>
              <dl className="preipo-facts">
                <div>
                  <dt>{PRIVATE_PROVIDER_LABELS[p.provider]} mark price</dt>
                  <dd>{usd(p.mark?.price ?? null)}</dd>
                </div>
                <div>
                  <dt>{PRIVATE_PROVIDER_LABELS[p.provider]} mark valuation</dt>
                  <dd>{usd(p.mark?.valuation ?? null, true)}</dd>
                </div>
                {p.providerToken?.price !== undefined && (
                  <div>
                    <dt>Provider token price</dt>
                    <dd>{usd(p.providerToken.price)}</dd>
                  </div>
                )}
                {p.providerToken?.impliedValuation !== undefined && (
                  <div>
                    <dt>Implied valuation</dt>
                    <dd>{usd(p.providerToken.impliedValuation, true)}</dd>
                  </div>
                )}
                <div>
                  <dt>Henar executable price</dt>
                  <dd>{p.execution?.status === "available" ? usd(p.execution.referenceUiPrice) : <span className="value-muted">{p.execution?.reason ?? "No verified route"}</span>}</dd>
                </div>
                <div>
                  <dt>Premium / discount to mark</dt>
                  <dd>{formatDeviation(markDeviation(p).priceDeviationBps)}</dd>
                </div>
                <div>
                  <dt>Holders</dt>
                  <dd>{p.holders === null ? <span className="value-muted">Not published</span> : count(p.holders)}</dd>
                </div>
              </dl>
              <p className="onchain-method">
                Mark from {p.mark?.provenance.source ?? "the provider"}, read {p.mark ? new Date(p.mark.provenance.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} · Executable price from Henar Router, {p.execution?.quotedAt ? new Date(p.execution.quotedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "unavailable"} · A provider mark is not an executable market price
              </p>
            </article>
          ))}
        </div>
      )}

      {section === "Liquidity" && (
        <div className="preipo-panels">
          {products.map((p) => (
            <article key={p.id}>
              <header>
                <h3>
                  {p.symbol} <small>{PRIVATE_PROVIDER_LABELS[p.provider]}</small>
                </h3>
              </header>
              {p.liquidity?.status === "available" ? (
                <>
                  <div className="preipo-depth">
                    <div className="preipo-depth-head">
                      <span>Size</span>
                      <span>Side</span>
                      <span>Price</span>
                      <span>Price impact</span>
                      <span>Route</span>
                    </div>
                    {p.liquidity.depth.map((d) => (
                      <div className="preipo-depth-row" key={`${d.side}-${d.notionalUsd}`}>
                        <span>${d.notionalUsd.toLocaleString()}</span>
                        <span>{d.side}</span>
                        <span>{d.status === "available" ? usd(d.uiPrice) : <span className="value-muted">{d.reason ?? "Unavailable"}</span>}</span>
                        <span>{d.priceImpactPct ? `${(Number(d.priceImpactPct) * 100).toFixed(3)}%` : "—"}</span>
                        <span>{d.route.map((r) => r.venue).filter(Boolean).join(" + ") || d.source || "—"}</span>
                      </div>
                    ))}
                  </div>
                  <p className="onchain-method">
                    Quotes include the Henar {(p.execution?.henarFeeBps ?? 10) / 100}% fee{p.onchain?.transferFeeBps ? ` and are net of the ${(p.onchain.transferFeeBps / 100).toFixed(2)}% Token-2022 transfer fee` : ""} · Indicative, not executable: the ticket always requests fresh terms
                  </p>
                </>
              ) : (
                <p className="fin-empty">No verified route for this product right now.</p>
              )}
              <div className="preipo-pools">
                {(p.liquidity?.verifiedPools ?? []).length ? (
                  (p.liquidity?.verifiedPools ?? []).map((pool) => (
                    <div key={pool.address}>
                      <span>
                        <strong>{pool.venue}</strong> <small>{short(pool.address)}</small>
                      </span>
                      <span>{pool.tvlUsd === null ? "TVL unknown" : usd(pool.tvlUsd, true)}</span>
                      <span>{pool.eligibility}</span>
                      <span className={pool.enabled ? "positive" : "value-muted"}>{pool.enabled ? `${pool.verification} · routable` : `${pool.verification} · not routed`}</span>
                    </div>
                  ))
                ) : (
                  <p className="onchain-method">No pool for this mint is in Henar&apos;s verified registry yet.</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {section === "Onchain" && (
        <div className="preipo-panels">
          {products.map((p) => (
            <article key={p.id}>
              <header>
                <h3>
                  {p.symbol} <small>{PRIVATE_PROVIDER_LABELS[p.provider]}</small>
                </h3>
              </header>
              {p.onchain?.status === "verified" ? (
                <dl className="preipo-facts">
                  <div>
                    <dt>Mint</dt>
                    <dd>
                      <a href={`https://solscan.io/token/${p.mint}`} target="_blank" rel="noreferrer">
                        {short(p.mint)} <ExternalLink size={11} />
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Token program</dt>
                    <dd>{p.onchain.isToken2022 ? "Token-2022" : "Token"}</dd>
                  </div>
                  <div>
                    <dt>Decimals</dt>
                    <dd>{p.onchain.decimals ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Supply</dt>
                    <dd>{p.onchain.supplyUi ? Number(p.onchain.supplyUi).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Transfer fee</dt>
                    <dd>{p.onchain.transferFeeBps === null ? "None" : `${(p.onchain.transferFeeBps / 100).toFixed(2)}%`}</dd>
                  </div>
                  <div>
                    <dt>Extensions</dt>
                    <dd>{p.onchain.extensions.length ? p.onchain.extensions.join(", ") : "None"}</dd>
                  </div>
                  <div>
                    <dt>Mint authority</dt>
                    <dd>{p.onchain.mintAuthority ? short(p.onchain.mintAuthority) : "None"}</dd>
                  </div>
                  <div>
                    <dt>Freeze authority</dt>
                    <dd>{p.onchain.freezeAuthority ? short(p.onchain.freezeAuthority) : "None"}</dd>
                  </div>
                  <div>
                    <dt>Permanent delegate</dt>
                    <dd>{p.onchain.permanentDelegate ? short(p.onchain.permanentDelegate) : "None"}</dd>
                  </div>
                  {p.onchain.scaledUiMultiplier && p.onchain.scaledUiMultiplier !== "1" && (
                    <div>
                      <dt>Scaled UI multiplier</dt>
                      <dd>{p.onchain.scaledUiMultiplier}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Router support</dt>
                    <dd className={p.onchain.routerSupported ? "positive" : "negative"}>{p.onchain.routerSupported ? "Every extension understood" : (p.onchain.unsupportedReason ?? "Unsupported")}</dd>
                  </div>
                  <div>
                    <dt>Read at slot</dt>
                    <dd>{p.onchain.slot ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="fin-empty">{p.onchain?.error ?? "Onchain state unavailable."}</p>
              )}
            </article>
          ))}
        </div>
      )}

      {section === "About" && (
        <div className="company-overview">
          <div className="company-overview-grid">
            {products.map((p) => (
              <article key={p.id}>
                <span>{PRIVATE_PROVIDER_LABELS[p.provider].toUpperCase()}</span>
                <h2>{p.name}</h2>
                <p className="preipo-prose">{p.description ?? p.structure.description}</p>
                <ul className="preipo-links">
                  {p.externalUrl && (
                    <li>
                      <a href={p.externalUrl} target="_blank" rel="noreferrer">
                        Product page <ExternalLink size={12} />
                      </a>
                    </li>
                  )}
                  <li>
                    <a href={p.documentationUrl} target="_blank" rel="noreferrer">
                      Provider documentation <ExternalLink size={12} />
                    </a>
                  </li>
                  {PROVIDER_DOCS[p.provider].terms && (
                    <li>
                      <a href={PROVIDER_DOCS[p.provider].terms!} target="_blank" rel="noreferrer">
                        Terms and conditions <ExternalLink size={12} />
                      </a>
                    </li>
                  )}
                </ul>
                {p.eligibility && <p className="onchain-method">{p.eligibility.note}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      <p className="onchain-method">
        {sources.map((s) => `${PRIVATE_PROVIDER_LABELS[s.provider]}: ${s.status}`).join(" · ")} · Read {new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · <Link href="/markets/pre-ipo">All Pre-IPO markets</Link>
      </p>
    </section>
  );
}
