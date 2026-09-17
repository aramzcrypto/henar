"use client";

import Link from "next/link";

export type MarketsView = "overview" | "all" | "pre-ipo" | "calendar" | "data";

const items: { value: MarketsView; label: string; href: string }[] = [
  { value: "overview", label: "Overview", href: "/markets" },
  { value: "all", label: "All markets", href: "/markets?view=all" },
  { value: "pre-ipo", label: "Pre-IPO", href: "/markets/pre-ipo" },
  { value: "calendar", label: "Calendar", href: "/markets/calendar" },
  /* The Pyth coverage surface used to be reachable only by opening a company,
     switching to its Onchain tab and clicking through the price panel — four
     unsignposted steps for the page that explains where every price on the
     product comes from. */
  { value: "data", label: "Market data", href: "/markets/data" },
];

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
