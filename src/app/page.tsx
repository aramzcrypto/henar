import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, Layers3, MoveUpRight } from "lucide-react";
import { stocks } from "@/lib/registry";
import styles from "./landing.module.css";

export default function Home() {
  const featured = ["AAPLx", "NVDAx", "TSLAx", "GOOGLx", "AMZNx"].flatMap(
    (ticker) => stocks.find((stock) => stock.ticker === ticker) ?? [],
  );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className="brand" aria-label="Stockroom home">
          <Layers3 size={26} strokeWidth={1.6} /> stockroom
        </Link>
        <Link href="/trade" className={styles.navLink}>
          Open app <ArrowUpRight size={16} />
        </Link>
      </header>
      <main className={styles.main}>
        <div className={styles.eyebrow}>
          <span /> Stocks, on your terms
        </div>
        <h1>
          Trade stocks.
          <br />
          <span>Earn while you wait.</span>
        </h1>
        <p className={styles.description}>
          Your favorite companies, on Solana.
          <br />
          Buy today. Yield on waiting USDC limit orders is coming next.
        </p>
        <Link href="/trade" className={styles.cta}>
          Explore stocks <ArrowRight size={18} />
        </Link>
        <div
          className={styles.stockStrip}
          aria-label="Explore Apple, NVIDIA, Tesla, Alphabet and Amazon"
        >
          <div className={styles.logos}>
            {featured.map((stock) => (
              <Image
                key={stock.mint}
                src={stock.logo}
                width={38}
                height={38}
                alt={stock.name}
                unoptimized
              />
            ))}
          </div>
          <span>
            {stocks.length.toLocaleString("en-US")} stock &amp; ETF listings
          </span>
        </div>
        <section
          className={styles.preview}
          aria-label="Upcoming yield limit orders"
        >
          <div className={styles.previewTop}>
            <span>THE WAIT, REIMAGINED</span>
            <span className={styles.soon}>Yield · Coming soon</span>
          </div>
          <div className={styles.flow}>
            <div>
              <span className={styles.step}>01</span>
              <h2>Set your price</h2>
              <p>Place a limit order in USDC.</p>
            </div>
            <div className={styles.yieldStep}>
              <span className={styles.step}>
                02 <MoveUpRight size={15} />
              </span>
              <h2>Let the wait earn</h2>
              <p>Unfilled funds can earn variable yield.</p>
            </div>
            <div>
              <span className={styles.step}>03</span>
              <h2>Own the stock</h2>
              <p>Buy when your price is reached.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>One place. Three stock providers.</span>
        <div>
          <span>xStocks</span>
          <span>Ondo</span>
          <span>Backpack Securities</span>
        </div>
        <Link href="/trade">
          Enter Stockroom <ArrowUpRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
