import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { MarketsTabs } from "@/components/markets-tabs";
import { PythCoveragePanel } from "@/components/pyth-coverage";
import { henarFlag } from "@/lib/feature-flags";
import { pythCoverage } from "@/lib/pyth/coverage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Market data · Henar",
  description: "Pyth Pro coverage and entitlement behind Henar's market data.",
};

export default async function Page() {
  const enabled = henarFlag("pythPro");
  const coverage = enabled ? await pythCoverage().catch(() => null) : null;
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <section className="markets-shell">
          <h1 className="sr-only">Market data</h1>
          <div className="markets-controls">
            <MarketsTabs active="data" />
          </div>
          <PythCoveragePanel coverage={coverage} enabled={enabled} />
        </section>
      </main>
    </div>
  );
}
