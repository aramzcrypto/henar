import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { HenarBrand } from "@/components/henar-brand";
import styles from "../docs.module.css";

export const metadata: Metadata = {
  title: "Docs · Henar",
  description: "Henar documentation is coming soon.",
};

export default function DocsPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandGroup}>
          <Link href="/" className="brand" aria-label="Henar home">
            <HenarBrand />
          </Link>
          <Link href="/docs" className={styles.docsLabel}>
            Docs
          </Link>
        </div>
        <Link href="/trade" className={styles.openApp}>
          Open app <ArrowUpRight size={15} />
        </Link>
      </header>

      <main className={styles.comingSoon}>
        <span>Documentation</span>
        <h1>Coming soon</h1>
      </main>
    </div>
  );
}
