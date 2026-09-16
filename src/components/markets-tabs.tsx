"use client";

import Link from "next/link";

export type MarketsView = "overview" | "all" | "pre-ipo" | "calendar";

const items: { value: MarketsView; label: string; href: string }[] = [
  { value: "overview", label: "Overview", href: "/markets" },
  { value: "all", label: "All markets", href: "/markets?view=all" },
  { value: "pre-ipo", label: "Pre-IPO", href: "/markets/pre-ipo" },
  { value: "calendar", label: "Calendar", href: "/markets/calendar" },
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
