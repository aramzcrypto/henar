import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Crosshair,
  FileText,
  Layers,
  Newspaper,
  Repeat2,
} from "lucide-react";
import { HenarBrand } from "@/components/henar-brand";
import { HeroGlobe } from "@/components/hero-globe";
import { LandingUnify } from "@/components/landing-unify";
import {
  equityForTicker,
  multiIssuerStats,
  universeStats,
} from "@/lib/equities/registry";
import styles from "./landing.module.css";

const researchItems = [
  {
    icon: FileText,
    name: "Financials",
    description: "Income, balance sheet and cash flow from filed XBRL.",
  },
  {
    icon: CalendarDays,
    name: "Calendar",
    description: "Earnings and macro events in month, week and day views.",
  },
  {
    icon: Newspaper,
    name: "News & filings",
    description: "Coverage and every 10-K, 10-Q and 8-K as filed.",
  },
  {
    icon: Layers,
    name: "Onchain",
    description: "Every issuer representation, compared side by side.",
  },
];

const tradeModes = [
  {
    icon: Repeat2,
    name: "Swap",
    description: "Route across available liquidity.",
  },
  {
    icon: Crosshair,
    name: "Limit + Yield",
    description: "Put idle orders to work.",
  },
  {
    icon: Clock3,
    name: "DCA",
    description: "Build positions on a schedule.",
  },
];

// A company that exists on all three issuers makes the point without
// needing a caption.
const example = equityForTicker("NVDA");

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className="brand" aria-label="Henar home">
          <HenarBrand />
        </Link>
        <nav className={styles.headerLinks} aria-label="Main navigation">
          <Link href="/markets">Markets</Link>
          <Link href="/trade">Trade</Link>
          <Link href="/earn">Earn</Link>
          <Link href="/docs">Docs</Link>
        </nav>
        <Link href="/markets" className={styles.launchLink}>
          Open Henar <ArrowRight size={14} />
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <HeroGlobe />
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Stocks · Onchain</span>
            <h1>
              One company. <span>Every representation.</span>
            </h1>
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
          <div className={styles.sectionCopy}>
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

        <section className={styles.researchSection}>
          <div className={styles.sectionCopy}>
            <span className={styles.eyebrow}>Research</span>
            <h2>Know what you own.</h2>
            <p>Filed fundamentals and events, straight from the source.</p>
            <Link href="/markets/calendar" className={styles.textLink}>
              Open calendar <ArrowRight size={14} />
            </Link>
          </div>
          <div className={styles.researchGrid}>
            {researchItems.map(({ icon: Icon, name, description }) => (
              <div className={styles.researchItem} key={name}>
                <Icon size={18} strokeWidth={1.6} />
                <h3>{name}</h3>
                <p>{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.tradeSection}>
          <div className={styles.sectionCopy}>
            <span className={styles.eyebrow}>Trade</span>
            <h2>More ways to trade.</h2>
            <p>Choose the execution that fits the position.</p>
            <Link href="/trade" className={styles.textLink}>
              Open trade <ArrowRight size={14} />
            </Link>
          </div>
          <div className={styles.tradeModes}>
            {tradeModes.map(({ icon: Icon, name, description }, index) => (
              <div className={styles.tradeMode} key={name}>
                <span className={styles.modeNumber}>0{index + 1}</span>
                <Icon size={19} strokeWidth={1.6} />
                <div>
                  <h3>{name}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.earnSection}>
          <div className={styles.sectionCopy}>
            <span className={styles.eyebrow}>Earn</span>
            <h2>Yield into stocks.</h2>
            <p>
              Deposit USDC and direct the yield into stock exposure. Stock pools
              across Solana are listed alongside it.
            </p>
            <Link href="/earn" className={styles.textLink}>
              Open earn <ArrowRight size={14} />
            </Link>
          </div>
        </section>

        <section className={styles.finalCta}>
          <span className={styles.eyebrow}>Henar</span>
          <h2>Stocks, unified.</h2>
          <Link href="/markets" className={styles.primaryAction}>
            Open Henar <ArrowRight size={15} />
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Henar · Solana stock markets</span>
        <Link href="/docs">Docs</Link>
      </footer>
    </div>
  );
}
