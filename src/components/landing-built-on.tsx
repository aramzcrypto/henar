import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/**
 * What Henar is built on, and where to see each piece working.
 *
 * The landing page described the product and named none of the
 * infrastructure under it, so the only way to discover the Pyth surface or
 * DBC Studio was to already know the URL. Each row is a claim with a link
 * that proves it, which is the difference between saying a thing is
 * integrated and showing it.
 *
 * Every line here is checkable against the running product. Nothing is
 * aspirational: if a surface is not live, it does not get a row.
 */
const INTEGRATIONS = [
  {
    name: "Pyth Pro",
    what: "Market data",
    detail:
      "Underlying equity feeds and tokenized references side by side, with publisher count, confidence and session on every price. The router is guarded against them.",
    href: "/markets/data",
    cta: "Coverage and entitlement",
  },
  {
    name: "PreStocks",
    what: "Pre-IPO exposure",
    detail:
      "Eleven private-market products, every mint verified on chain, priced against the provider's own mark so the premium or discount is visible.",
    href: "/markets/pre-ipo",
    cta: "Pre-IPO markets",
  },
  {
    name: "Tessera",
    what: "Pre-IPO exposure",
    detail:
      "T-OpenAI, T-Kalshi and T-SpaceX, quotable through Henar's own router with the 20 bps transfer fee netted out of the floor.",
    href: "/markets/pre-ipo",
    cta: "Pre-IPO markets",
  },
  {
    name: "Meteora",
    what: "Liquidity and launches",
    detail:
      "DLMM pools carry the private-market book and take a leg in Henar's split routes. DBC Studio configures and monitors bonding-curve launches.",
    href: "/studio",
    cta: "DBC Studio",
  },
];

export function LandingBuiltOn() {
  return (
    <div className="built-on" data-reveal>
      {INTEGRATIONS.map((item, index) => (
        <article
          className="built-on-item"
          key={item.name}
          data-reveal
          style={{ "--reveal-delay": `${index * 80}ms` } as React.CSSProperties}
        >
          <header>
            <h3>{item.name}</h3>
            <span>{item.what}</span>
          </header>
          <p>{item.detail}</p>
          <Link href={item.href}>
            {item.cta} <ArrowUpRight size={13} strokeWidth={1.8} />
          </Link>
        </article>
      ))}
    </div>
  );
}
