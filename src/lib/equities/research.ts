import type { EquityResearch, ResearchSection } from "./types";
import type { Equity } from "./types";
import { unstable_cache } from "next/cache";
import { secResearchForEquity } from "./sec";
import { gdeltNewsForEquity } from "./gdelt";
import {
  readNewsCache,
  readResearchCache,
  writeNewsCache,
  writeResearchCache,
} from "./research-cache";
import {
  readResearchFileCache,
  writeResearchFileCache,
} from "./research-file-cache";

function unavailable<T>(): ResearchSection<T> {
  return { status: "unavailable", data: null, asOf: null, sourceUrl: null };
}

export function researchForEquity(): EquityResearch {
  return {
    profile: unavailable(),
    financials: unavailable(),
    earnings: unavailable(),
    dividends: unavailable(),
    filings: unavailable(),
    news: unavailable(),
  };
}

// Concurrent requests for the same cold ticker previously each downloaded the
// full SEC company-facts payload. They now share one in-flight promise.
const inFlight = new Map<string, Promise<EquityResearch>>();

function dedupe(ticker: string, load: () => Promise<EquityResearch>) {
  const existing = inFlight.get(ticker);
  if (existing) return existing;
  const promise = load().finally(() => inFlight.delete(ticker));
  inFlight.set(ticker, promise);
  return promise;
}

async function loadSecResearch(equity: Equity): Promise<EquityResearch> {
  const fromFile = await readResearchFileCache(equity.ticker);
  if (fromFile) return fromFile;
  const fromDatabase = await readResearchCache(equity.ticker);
  if (fromDatabase) {
    await writeResearchFileCache(equity.ticker, fromDatabase);
    return fromDatabase;
  }
  const research = await secResearchForEquity(equity);
  await Promise.all([
    writeResearchCache(equity.ticker, research),
    writeResearchFileCache(equity.ticker, research),
  ]);
  return research;
}

const cachedResearch = unstable_cache(
  async (equity: Equity) => {
    const [research, news] = await Promise.all([
      dedupe(equity.ticker, () => loadSecResearch(equity)),
      loadNews(equity),
    ]);
    return { ...research, news };
  },
  ["henar-equity-research-v7"],
  { revalidate: 3_600 },
);

async function loadNews(equity: Equity) {
  const cached = await readNewsCache(equity.ticker);
  if (cached) return cached;
  const news = await gdeltNewsForEquity(equity);
  if (news.status === "available" && news.data) {
    await writeNewsCache(equity.ticker, news.data);
  }
  return news ?? unavailable();
}

export async function loadResearchForEquity(equity: Equity) {
  return cachedResearch(equity);
}
