import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { MarketsTabs } from "@/components/markets-tabs";
import { PythCoveragePanel } from "@/components/pyth-coverage";
import { PythLiveReferences } from "@/components/pyth-live-references";
import { companyPythForTicker, type CompanyPyth } from "@/lib/pyth/company";
import { henarFlag } from "@/lib/feature-flags";
import { pythCoverage } from "@/lib/pyth/coverage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Market data · Henar",
  description: "Live Pyth reference prices and the entitlement behind Henar's market data.",
};

/* Probed rather than configured: whichever of these the current key can read
   become the page. A wider entitlement lengthens the list with no code change,
   and a narrower one shortens it honestly instead of showing dead cards.
   Kept short because each is a live read and the page waits on all of them. */
const CANDIDATES = ["TSLA", "QQQ", "SPY", "NVDA"];

async function LiveReferences() {
  const probed = await Promise.all(CANDIDATES.map((t) => companyPythForTicker(t).catch(() => null)));
  const live = probed.filter((c): c is CompanyPyth => c !== null && c.underlying.reference !== null);
  if (!live.length) return null;
  return (
    <section className="pyth-live-section">
      <div className="pyth-live-head">
        <span className="markets-eyebrow">Live reference prices</span>
        <h2>What Henar is pricing against, right now.</h2>
        <p>
          Every company this entitlement can read, with its underlying market
          beside each tokenized claim on it.
        </p>
      </div>
      <PythLiveReferences companies={live} />
    </section>
  );
}

/**
 * Coverage streams in on its own.
 *
 * The entitlement probe asks Pyth about 119 feeds and takes tens of seconds,
 * and it used to be awaited alongside the prices — so a page whose point is
 * live data sat blank for the length of an audit. The prices are a handful of
 * reads and paint on their own; the coverage table arrives when it arrives.
 */
async function Coverage({ enabled }: { enabled: boolean }) {
  const coverage = enabled ? await pythCoverage().catch(() => null) : null;
  return <PythCoveragePanel coverage={coverage} enabled={enabled} />;
}

export default function Page() {
  const enabled = henarFlag("pythPro");
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <section className="markets-shell">
          <h1 className="sr-only">Market data</h1>
          <div className="markets-controls">
            <MarketsTabs active="overview" />
          </div>
          {enabled && (
            <Suspense fallback={<div className="pyth-live-pending" aria-busy="true" />}>
              <LiveReferences />
            </Suspense>
          )}
          <Suspense fallback={<div className="pyth-coverage-pending" aria-busy="true">Measuring entitlement…</div>}>
            <Coverage enabled={enabled} />
          </Suspense>
        </section>
      </main>
    </div>
  );
}
