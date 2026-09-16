import type { Metadata } from "next";
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

export default async function Page() {
  if (!henarFlag("preIpoMarkets")) notFound();
  const markets = await loadPrivateMarkets({ onchain: true, execution: true }).catch(() => null);
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <PreIpoMarkets initial={markets} />
      </main>
    </div>
  );
}
