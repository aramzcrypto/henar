import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { PreIpoMarkets } from "@/components/pre-ipo-markets";
import { henarFlag } from "@/lib/feature-flags";
import { loadPrivateMarkets } from "@/lib/private-markets/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pre-IPO · Henar Markets",
  description: "Private-market exposure on Solana, by company and by provider.",
};

/**
 * Private markets, read from chain with execution state attached.
 *
 * `onchain: true` means mint and pool reads for every product, and awaiting it
 * in the page blocked the shell for the whole set. Streaming it lets the
 * chrome paint at once; the table arrives when the reads finish.
 */
async function Markets() {
  const markets = await loadPrivateMarkets({ onchain: true, execution: true }).catch(() => null);
  return <PreIpoMarkets initial={markets} />;
}

export default function Page() {
  if (!henarFlag("preIpoMarkets")) notFound();
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <Suspense fallback={<div className="markets-page-loading" aria-busy="true"><span /><span /><span /><span /></div>}>
          <Markets />
        </Suspense>
      </main>
    </div>
  );
}
