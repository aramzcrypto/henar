import Image from "next/image";
import { CalendarDays, FileText, Layers, LineChart } from "lucide-react";
import { ISSUER_LABELS, ISSUER_LOGOS } from "./landing-unify";

/**
 * Research as four equal cards, each with a fragment of interface bled into
 * its top and faded out behind the copy.
 *
 * The fragments carry structure, never measurements: real issuer names, real
 * token symbols and real SEC form types, but no prices, no percentages and no
 * figures of any kind. A landing page that invented a revenue number would
 * contradict the data policy the rest of the product is built on.
 */
type Representation = { provider: string; symbol: string };

const STATEMENT_ROWS = [
  { label: "Revenue", fill: 100 },
  { label: "Operating income", fill: 62 },
  { label: "Net income", fill: 44 },
];

const FILINGS = ["10-K", "10-Q", "8-K"];

/* Marked days stand for "events land here", not for any particular month. */
const CALENDAR_MARKS = new Set([3, 9, 16, 17, 24, 30]);

export function LandingResearch({
  representations,
}: {
  representations: Representation[];
}) {
  return (
    <div className="lbento">
      <article className="lcard" data-reveal>
        <div className="lmock">
          <div className="lmock-head">
            <LineChart size={13} strokeWidth={1.7} />
            Income statement
          </div>
          <div className="lmock-statement">
            {STATEMENT_ROWS.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <i style={{ width: `${row.fill}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="lcard-copy">
          <h3>Financials</h3>
          <p>Income, balance sheet and cash flow, exactly as filed.</p>
        </div>
      </article>

      <article
        className="lcard"
        data-reveal
        style={{ "--reveal-delay": "90ms" } as React.CSSProperties}
      >
        <div className="lmock">
          <div className="lmock-head">
            <CalendarDays size={13} strokeWidth={1.7} />
            Month
          </div>
          <div className="lmock-calendar">
            {Array.from({ length: 35 }, (_, day) => (
              <span
                key={day}
                data-mark={CALENDAR_MARKS.has(day) ? "" : undefined}
              />
            ))}
          </div>
        </div>
        <div className="lcard-copy">
          <h3>Calendar</h3>
          <p>Earnings and macro events in month, week and day views.</p>
        </div>
      </article>

      <article
        className="lcard"
        data-reveal
        style={{ "--reveal-delay": "180ms" } as React.CSSProperties}
      >
        <div className="lmock">
          <div className="lmock-head">
            <FileText size={13} strokeWidth={1.7} />
            Filings
          </div>
          <div className="lmock-filings">
            {FILINGS.map((form) => (
              <div key={form}>
                <b>{form}</b>
                <i />
              </div>
            ))}
          </div>
        </div>
        <div className="lcard-copy">
          <h3>News &amp; filings</h3>
          <p>Coverage and every 10-K, 10-Q and 8-K as filed.</p>
        </div>
      </article>

      <article
        className="lcard"
        data-reveal
        style={{ "--reveal-delay": "270ms" } as React.CSSProperties}
      >
        <div className="lmock">
          <div className="lmock-head">
            <Layers size={13} strokeWidth={1.7} />
            One company, every representation
          </div>
          <div className="lmock-onchain">
            {representations.map((item) => (
              <div key={item.provider}>
                <Image
                  src={ISSUER_LOGOS[item.provider]}
                  alt=""
                  width={17}
                  height={17}
                />
                <b>{item.symbol}</b>
                <span>{ISSUER_LABELS[item.provider] ?? item.provider}</span>
                <i />
              </div>
            ))}
          </div>
        </div>
        <div className="lcard-copy">
          <h3>Onchain</h3>
          <p>Every issuer representation, compared side by side.</p>
        </div>
      </article>
    </div>
  );
}
