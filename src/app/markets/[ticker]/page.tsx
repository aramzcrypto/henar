import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { MarketDetail } from "@/components/market-detail";
import { equityForTicker } from "@/lib/equities/registry";
import { loadResearchForEquity } from "@/lib/equities/research";
import { tradableRepresentations } from "@/lib/dbc/market-coverage";

type Props = { params: Promise<{ ticker: string }> };
export const dynamic = "force-dynamic";
export function generateStaticParams() {
  return [];
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const equity = equityForTicker((await params).ticker);
  return equity
    ? { title: `${equity.name} (${equity.ticker}) · Henar` }
    : { title: "Market not found · Henar" };
}
export default async function Page({ params }: Props) {
  const equity = equityForTicker((await params).ticker);
  if (!equity) notFound();
  // Research is streamed rather than awaited. SEC company facts are large and
  // slow on a cold cache; blocking here delayed the whole page by seconds.
  const research = loadResearchForEquity(equity);
  /* Pool state is registry data and belongs on the server; the reference price
     that sizes a proposal arrives with the client's live comparison. */
  const hasMarket = tradableRepresentations(equity).length > 0;
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <MarketDetail equity={equity} research={research} hasMarket={hasMarket} />
      </main>
    </div>
  );
}
