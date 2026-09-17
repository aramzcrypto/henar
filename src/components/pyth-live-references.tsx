import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CompanyPyth } from "@/lib/pyth/company";

/**
 * The prices, first.
 *
 * This page used to open on coverage statistics — 897 of 1,339 mapped, 2 of
 * 119 readable — which is an operations dashboard, not market data. It showed
 * no price, nothing moving, and its headline numbers advertised how little the
 * current key can read. A page called Market data has to show market data.
 *
 * So the entitlement decides the content rather than being the content: every
 * company whose underlying feed this key can actually read gets a card with
 * its live price, and the coverage table moves underneath as the explanation
 * of why the list is the length it is. A wider key makes this page longer
 * with no code change, which is the same property the coverage panel claims.
 */

const price = (value: string | null | undefined, exponent?: number) => {
  if (!value) return "—";
  const n = Number(value) * (exponent === undefined ? 1 : 1);
  return Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
};

const SESSION_LABEL: Record<string, string> = {
  regular: "Regular session",
  preMarket: "Pre-market",
  postMarket: "After hours",
  overNight: "Overnight",
  closed: "Closed",
};

function age(observedAt: string | null | undefined, updatedAt: string | null | undefined) {
  if (!observedAt || !updatedAt) return null;
  const ms = Date.parse(observedAt) - Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export function PythLiveReferences({ companies }: { companies: CompanyPyth[] }) {
  if (!companies.length) return null;
  return (
    <div className="pyth-live">
      {companies.map((company) => {
        const ref = company.underlying.reference;
        const mapped = company.representations.filter((r) => r.feed);
        return (
          <article className="pyth-live-card" key={company.ticker}>
            <header>
              <div>
                <span className="pyth-live-symbol">{company.underlying.feed?.symbol ?? company.ticker}</span>
                <strong>{price(ref?.price)}</strong>
              </div>
              <Link href={`/markets/${company.ticker}`}>
                {company.ticker} <ArrowUpRight size={12} strokeWidth={1.9} />
              </Link>
            </header>

            <dl className="pyth-live-facts">
              <div>
                <dt>Session</dt>
                <dd>{ref?.marketSession ? (SESSION_LABEL[ref.marketSession] ?? ref.marketSession) : "—"}</dd>
              </div>
              <div>
                <dt>Publishers</dt>
                <dd>{ref?.publisherCount ?? "—"}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{ref?.confidenceBps === null || ref?.confidenceBps === undefined ? "—" : `${ref.confidenceBps} bps`}</dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>{age(company.observedAt, ref?.feedUpdatedAt) ?? "—"}</dd>
              </div>
            </dl>

            {/* The comparison the whole surface exists for: one company, its
                underlying market and every tokenized claim on it, each said to
                be readable or not rather than quietly omitted. */}
            <ul className="pyth-live-reps">
              {mapped.map((rep) => (
                <li key={rep.representationId}>
                  <span>{rep.tokenSymbol}</span>
                  <em>{rep.provider}</em>
                  <b data-state={rep.availability}>
                    {rep.reference ? price(rep.reference.price) : rep.availability === "NOT_ENTITLED" ? "Not entitled" : "No reference"}
                  </b>
                </li>
              ))}
              {!mapped.length && <li className="pyth-live-none">No tokenized feed for this company in the Pyth catalog</li>}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
