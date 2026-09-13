import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Clock3,
  Crosshair,
  Repeat2,
} from "lucide-react";
import { HenarBrand } from "@/components/henar-brand";
import { LandingMarketPreview } from "@/components/landing-market-preview";
import styles from "./landing.module.css";

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
          <Link href="/docs">Docs</Link>
        </nav>
        <Link href="/markets" className={styles.launchLink}>
          Open Henar <ArrowRight size={14} />
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Stocks · Onchain</span>
            <h1>
              One layer for every <span>stock market on Solana.</span>
            </h1>
            <p>
              Henar unifies markets, execution and yield across verified
              tokenized stocks.
            </p>
            <div className={styles.heroActions}>
              <Link href="/markets" className={styles.primaryAction}>
                Explore markets <ArrowRight size={15} />
              </Link>
              <Link href="/trade" className={styles.secondaryAction}>
                Trade stocks
              </Link>
            </div>
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
              </div>
              <span className={styles.solanaLogo} aria-label="Solana">
                <Image src="/logos/issuers/solana.svg" alt="" width={81} height={17} />
              </span>
            </div>
          </div>
        </section>

        <section className={styles.marketsSection}>
          <div className={styles.sectionCopy}>
            <span className={styles.eyebrow}>Markets</span>
            <h2>One company.<br />Every market.</h2>
            <p>
              Compare live prices, liquidity and volume across verified Solana
              representations.
            </p>
            <Link href="/markets" className={styles.textLink}>
              View markets <ArrowRight size={14} />
            </Link>
          </div>
          <LandingMarketPreview />
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
