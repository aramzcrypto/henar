import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { HenarBrand } from "@/components/henar-brand";
import { HeroGlobe } from "@/components/hero-globe";
import { LandingAtmosphere } from "@/components/landing-atmosphere";
import { ThemeToggle } from "@/components/theme-toggle";
import { LandingUnify } from "@/components/landing-unify";
import { LandingCompanies } from "@/components/landing-companies";
import { LandingResearch } from "@/components/landing-research";
import { LandingTrade } from "@/components/landing-trade";
import { LandingEarn } from "@/components/landing-earn";
import { LandingBuiltOn } from "@/components/landing-built-on";
import { LandingRing } from "@/components/landing-ring";
import { ScrollReveal } from "@/components/scroll-reveal";
import {
  equityForTicker,
  multiIssuerEquities,
  multiIssuerStats,
  universeStats,
} from "@/lib/equities/registry";
import styles from "./landing.module.css";


/* multiIssuerEquities sorts by ticker, so taking the first nine opens the deck
   on whatever is alphabetically first. Lead with names a visitor recognises,
   then top up from the registry; every entry is still a real company carrying
   three verified issuer representations. */
const FAN_PREFERRED = [
  "NVDA",
  "AAPL",
  "TSLA",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "SPY",
  "COIN",
];

const fanCompanies = (() => {
  const pool = multiIssuerEquities(400);
  const byTicker = new Map(pool.map((equity) => [equity.ticker, equity]));
  const picked = FAN_PREFERRED.map((ticker) => byTicker.get(ticker)).filter(
    (equity) => equity !== undefined,
  );
  for (const equity of pool) {
    if (picked.length >= 9) break;
    if (!picked.includes(equity)) picked.push(equity);
  }
  return picked.slice(0, 9).map((equity) => ({
    ticker: equity.ticker,
    name: equity.name,
    logo: equity.logo,
    issuers: new Set(equity.representations.map((item) => item.provider)).size,
  }));
})();

const earnStocks = fanCompanies.slice(0, 3).map((company) => ({
  ticker: company.ticker,
  logo: company.logo,
}));



// A company that exists on all three issuers makes the point without
// needing a caption.
const example = equityForTicker("NVDA");

export default function Home() {
  return (
    <div className={styles.page}>
      <LandingAtmosphere />
      <header className={styles.header}>
        <Link href="/" className="brand" aria-label="Henar home">
          <HenarBrand />
        </Link>
        <nav className={styles.headerLinks} aria-label="Main navigation">
          <Link href="/markets">Markets</Link>
          <Link href="/trade">Trade</Link>
          <Link href="/earn">Earn</Link>
          {/* Behind the same public flag the route checks, so the link exists
              exactly when the page does. */}
          {process.env.NEXT_PUBLIC_HENAR_DBC_STUDIO === "1" ? <Link href="/studio">Studio</Link> : null}
          <Link href="/docs">Docs</Link>
        </nav>
        <div className={styles.headerRight}>
          <ThemeToggle />
          <Link href="/markets" className={styles.launchLink}>
            Open Henar <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <HeroGlobe />
          <div className={styles.heroCopy}>
            <h1>Stocks, unified.</h1>
            <p>
              The market and intelligence layer for stocks on Solana.
            </p>
            <div className={styles.networks} aria-label="Markets unified by Henar">
              <div className={styles.issuerRow}>
                <span className={styles.networkLabel}>Across</span>
                <span className={styles.networkItem}>
                  <Image src="/logos/issuers/xstocks.svg" alt="" width={17} height={17} />
                  xStocks
                </span>
                <span className={styles.networkItem}>
                  <Image src="/logos/issuers/backpack.svg" alt="" width={13} height={18} />
                  Backpack
                </span>
                <span className={styles.networkItem}>
                  <Image src="/logos/issuers/ondo.svg" alt="" width={17} height={17} />
                  Ondo
                </span>
                <span className={styles.solanaLogo} aria-label="Solana">
                  <Image src="/logos/issuers/solana.svg" alt="" width={73} height={15} />
                </span>
              </div>
            </div>
          </div>
        </section>

        {example ? (
        <section className={styles.marketsSection}>
          <div className={styles.sectionCopy} data-reveal>
            <span className={styles.eyebrow}>Markets</span>
            <h2>One company.<br />Every market.</h2>
            <p>
              Compare price, liquidity and execution across every verified
              issuer representation.
            </p>
            <dl className={styles.sectionStats}>
              <div>
                <dt>Companies</dt>
                <dd>{universeStats.companies.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Representations</dt>
                <dd>{universeStats.representations.toLocaleString()}</dd>
              </div>
              <div>
                <dt>On all three</dt>
                <dd>{multiIssuerStats.allIssuers.toLocaleString()}</dd>
              </div>
            </dl>
            <Link href="/markets" className={styles.textLink}>
              View markets <ArrowRight size={14} />
            </Link>
          </div>
          <LandingUnify
            company={example.name}
            ticker={example.ticker}
            logo={example.logo}
            representations={example.representations.map((item) => ({
              provider: item.provider,
              symbol: item.tokenSymbol,
            }))}
          />
        </section>
        ) : null}

        {/* A tall track holding a pinned stage: the deck advances with scroll
            position instead of a timer, so the reader drives it. */}
        <section className={styles.companiesSection} data-fan-track>
          <div className={styles.companiesStage}>
            <div className={styles.sectionCopy} data-reveal>
              <span className={styles.eyebrow}>Coverage</span>
              <h2>Every company you know.</h2>
              <p>
                {universeStats.companies.toLocaleString()} companies and ETFs,
                grouped by the business rather than the token.
              </p>
            </div>
            <LandingCompanies companies={fanCompanies} />
          </div>
        </section>

        <section className={styles.researchSection}>
          <div className={styles.sectionCopy} data-reveal>
            <span className={styles.eyebrow}>Research</span>
            <h2>Know what you own.</h2>
            <p>Filed fundamentals and events, straight from the source.</p>
          </div>
          <LandingResearch
            representations={
              example
                ? example.representations.map((item) => ({
                    provider: item.provider,
                    symbol: item.tokenSymbol,
                  }))
                : []
            }
          />
        </section>

        <section className={styles.tradeSection}>
          <div className={styles.sectionCopy} data-reveal>
            <span className={styles.eyebrow}>Trade</span>
            <h2>Every venue, one ticket.</h2>
            <p>
              Henar quotes every connected venue at once and shows you what each
              one would pay — including the ones it cannot fill.
            </p>
          </div>
          <LandingTrade />
        </section>

        <section className={styles.earnSection}>
          <div className={styles.sectionCopy} data-reveal>
            <span className={styles.eyebrow}>Earn</span>
            <h2>Yield into stocks.</h2>
            <p>
              Deposit USDC and direct the yield into stock exposure. Stock pools
              across Solana are listed alongside it.
            </p>
          </div>
          <LandingEarn stocks={earnStocks} />
        </section>

        <section className={styles.tradeSection}>
          <div className={styles.sectionCopy} data-reveal>
            <span className={styles.eyebrow}>Built on</span>
            <h2>Where the data comes from.</h2>
            <p>
              Every price, product and route in Henar traces to a named source.
              Each one is live — follow the link and check it.
            </p>
          </div>
          <LandingBuiltOn />
        </section>

        <section className={styles.finalCta}>
          <LandingRing />
        </section>
      </main>
      <ScrollReveal />

      <footer className={styles.footer}>
        <span>Henar · Solana stock markets</span>
        <Link href="/docs">Docs</Link>
      </footer>
    </div>
  );
}
