"use client";

import Link from "next/link";

export type MarketsView = "overview" | "all" | "pre-ipo" | "calendar";

const items: { value: MarketsView; label: string; href: string }[] = [
  { value: "overview", label: "Overview", href: "/markets" },
  { value: "all", label: "All markets", href: "/markets?view=all" },
  { value: "pre-ipo", label: "Pre-IPO", href: "/markets/pre-ipo" },
  { value: "calendar", label: "Calendar", href: "/markets/calendar" },
];

/* Market data is deliberately not a tab. It is a provenance surface — what
   the price feeds are and what this key can read — which is evidence, not a
   destination someone browsing companies is looking for. It is reached from
   the landing page's sources section and from the "Powered by Pyth Pro" link
   on any company's price panel, which is where a reader who wants to know
   where a number came from actually is. */

/**
 * Overview and All markets are in-page views, so they switch without a
 * navigation when the handler is supplied. Calendar is a real route.
 */
export function MarketsTabs({
  active,
  onSelect,
}: {
  active: MarketsView;
  onSelect?: (view: "overview" | "all") => void;
}) {
  return (
    <div className="markets-page-tabs" role="tablist">
      {items.map((item) => {
        const selected = item.value === active;
        const className = selected ? "active" : "";
        if ((item.value === "overview" || item.value === "all") && onSelect) {
          const target = item.value;
          return (
            <button
              key={item.value}
              role="tab"
              aria-selected={selected}
              className={className}
              onClick={() => onSelect(target)}
            >
              {item.label}
            </button>
          );
        }
        return (
          <Link
            key={item.value}
            role="tab"
            aria-selected={selected}
            className={className}
            href={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
