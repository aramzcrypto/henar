import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { EarnPoolsPage } from "@/components/earn-pools-page";
import { FEATURED_POOL, loadEarnPools } from "@/lib/equities/earn/pools";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "Earn · Henar",
  description: "Yield strategies that turn idle capital into stock exposure.",
};

export default async function Page() {
  const { pools, notes } = await loadEarnPools().catch(() => ({
    pools: [],
    notes: [],
  }));
  return (
    <div className="app page-earn">
      <AppHeader active="earn" />
      <main className="markets-main">
        <EarnPoolsPage featured={FEATURED_POOL} pools={pools} notes={notes} />
      </main>
    </div>
  );
}
