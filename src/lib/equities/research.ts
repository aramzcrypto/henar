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

const cachedResearch = unstable_cache(async (equity: Equity) => {
  let research = await readResearchCache(equity.ticker);
  if (!research) {
    research = await secResearchForEquity(equity);
    await writeResearchCache(equity.ticker, research);
  }
  let news = await readNewsCache(equity.ticker);
  if (!news) {
    news = await gdeltNewsForEquity(equity);
    if (news.status === "available" && news.data) {
      await writeNewsCache(equity.ticker, news.data);
    }
  }
  return { ...research, news: news ?? unavailable() };
}, ["henar-equity-research-v3"], { revalidate: 3_600 });

export async function loadResearchForEquity(equity: Equity) {
  return cachedResearch(equity);
}
