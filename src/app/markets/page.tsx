import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { MarketsPage } from "@/components/markets-page";
import { listEquities } from "@/lib/equities/registry";
import { marketsOverview, summarizeEquities } from "@/lib/equities/jupiter";

export const revalidate = 15;
export const metadata: Metadata = {
  title: "Markets · Henar",
  description: "One company. Every valid Solana representation.",
};

export default async function Page() {
  const all = listEquities();
  const [items, overview] = await Promise.all([
    summarizeEquities(all.slice(0, 50)),
    marketsOverview().catch(() => ({
      items: [],
      totalVolume24hUsd: null,
      sourceTokenCount: 0,
      matchedCompanyCount: 0,
      asOf: new Date().toISOString(),
    })),
  ]);
  const representations = all.reduce(
    (sum, equity) => sum + equity.representations.length,
    0,
  );
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <MarketsPage
          initial={{ items, total: all.length, offset: 0, limit: 50 }}
          overview={overview}
          universe={{
            companies: all.length,
            representations,
            stocks: all.filter((equity) => equity.assetType === "stock").length,
            etfs: all.filter((equity) => equity.assetType === "etf").length,
            xstocks: all.filter((equity) =>
              equity.representations.some(
                (item) => item.provider === "xstocks",
              ),
            ).length,
            backpack: all.filter((equity) =>
              equity.representations.some(
                (item) => item.provider === "backpack",
              ),
            ).length,
            ondo: all.filter((equity) =>
              equity.representations.some((item) => item.provider === "ondo"),
            ).length,
          }}
        />
      </main>
    </div>
  );
}
