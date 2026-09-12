import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import { KaniBrand } from "@/components/kani-brand";
import styles from "./landing.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className="brand" aria-label="Kani Markets home">
          <KaniBrand />
        </Link>
        <Link href="/trade" className={styles.navLink}>
          Open app <ArrowUpRight size={16} />
        </Link>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1>
            Trade stocks.
            <br />
            <span>Earn while you wait.</span>
          </h1>
          <p className={styles.description}>
            Tokenized stocks. In your wallet. On Solana.
          </p>
          <Link href="/trade" className={styles.cta}>
            Start trading <ArrowRight size={18} />
          </Link>
          <span className={styles.availability}>
            Yield features coming soon
          </span>
        </div>
        <div className={styles.providers} aria-label="Stock providers">
          <span className={styles.providerLabel}>Stocks from</span>
          {[
            { name: "xStocks", asset: "xstocks.svg" },
            { name: "Ondo", asset: "ondo.svg" },
            { name: "Backpack", asset: "backpack.png" },
          ].map((provider) => (
            <span key={provider.name}>
              <Image
                src={`/logos/issuers/${provider.asset}`}
                width={22}
                height={22}
                alt=""
                unoptimized
              />
              {provider.name}
            </span>
          ))}
        </div>
      </main>
      <footer className={styles.footer}>
        <span>Kani Markets</span>
        <span>Built on Solana</span>
      </footer>
    </div>
  );
}
