import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import {
  MarketsPage,
  type OverviewEvent,
  type SectorHighlight,
  type SectorOption,
  type MultiIssuerSummary,
} from "@/components/markets-page";
import {
  equitiesForSector,
  listEquities,
  multiIssuerEquities,
  multiIssuerStats,
  sectorStats,
  universeStats,
} from "@/lib/equities/registry";
import { marketsOverview, summarizeEquities } from "@/lib/equities/jupiter";
import { isoDay, loadCalendar } from "@/lib/equities/calendar";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "Markets · Henar",
  description: "Company-level markets for verified tokenized equities.",
};

const SECTOR_BLOCKS = 6;
const SECTOR_COMPANIES = 4;
const EVENT_LIMIT = 5;
const MULTI_ISSUER_LIMIT = 8;
const EVENT_WINDOW_DAYS = 14;

const emptyOverview = {
  items: [],
  totalVolume24hUsd: null,
  sourceTokenCount: 0,
  matchedCompanyCount: 0,
  asOf: new Date().toISOString(),
};

/** Largest sectors first, each with its most-represented companies. */
function sectorHighlights(): SectorHighlight[] {
  return sectorStats.slice(0, SECTOR_BLOCKS).map(({ sector, companies }) => ({
    sector,
    companies,
    top: equitiesForSector(sector, SECTOR_COMPANIES).map((equity) => ({
      ticker: equity.ticker,
      name: equity.name,
      logo: equity.logo,
      representationCount: equity.representations.length,
    })),
  }));
}

/** The most recent verified earnings events, newest first. */
async function recentEvents(): Promise<OverviewEvent[]> {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(today.getUTCDate() - EVENT_WINDOW_DAYS);
  const end = new Date(today);
  end.setUTCDate(today.getUTCDate() + EVENT_WINDOW_DAYS);
  const calendar = await loadCalendar({
    start: isoDay(start),
    end: isoDay(end),
  });
  return calendar.earnings.events
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, EVENT_LIMIT)
    .map((event) => ({
      id: event.id,
      ticker: event.ticker,
      companyName: event.companyName,
      companyLogo: event.companyLogo,
      label: event.eventName ?? "Earnings",
      date: event.date,
    }));
}

/** Companies issued by every provider, the clearest case for one market view. */
function multiIssuerSummary(): MultiIssuerSummary {
  return {
    twoIssuers: multiIssuerStats.twoIssuers,
    allIssuers: multiIssuerStats.allIssuers,
    companies: multiIssuerEquities(MULTI_ISSUER_LIMIT).map((equity) => ({
      ticker: equity.ticker,
      name: equity.name,
      logo: equity.logo,
      tokens: equity.representations.map((representation) => ({
        provider: representation.provider,
        tokenSymbol: representation.tokenSymbol,
      })),
    })),
  };
}

export default async function Page() {
  const all = listEquities();
  const [items, overview, events] = await Promise.all([
    summarizeEquities(all.slice(0, 50)),
    marketsOverview().catch(() => emptyOverview),
    recentEvents().catch(() => [] as OverviewEvent[]),
  ]);
  return (
    <div className="app page-markets">
      <AppHeader active="markets" />
      <main className="markets-main">
        <MarketsPage
          initial={{ items, total: all.length, offset: 0, limit: 50 }}
          overview={overview}
          universe={universeStats}
          sectors={sectorHighlights()}
          sectorOptions={sectorStats satisfies SectorOption[]}
          events={events}
          multiIssuer={multiIssuerSummary()}
        />
      </main>
    </div>
  );
}
