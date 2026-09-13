import type { Equity, NewsItem, ResearchSection } from "./types";

const GDELT_CONTEXT_API = "https://api.gdeltproject.org/api/v2/context/context";
const GDELT_SOURCE = "https://www.gdeltproject.org/";

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
  language?: unknown;
};

function publishedAt(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseGdeltArticles(payload: unknown): NewsItem[] {
  const articles =
    payload && typeof payload === "object" && Array.isArray((payload as { articles?: unknown }).articles)
      ? (payload as { articles: GdeltArticle[] }).articles
      : [];
  const seen = new Set<string>();
  return articles.flatMap((article) => {
    if (
      typeof article.url !== "string" ||
      typeof article.title !== "string" ||
      typeof article.domain !== "string" ||
      article.title.trim().length === 0 ||
      article.domain.trim().length === 0
    ) return [];
    let url: URL;
    try {
      url = new URL(article.url);
    } catch {
      return [];
    }
    const date = publishedAt(article.seendate);
    if (url.protocol !== "https:" || !date || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{
      id: url.href,
      headline: article.title.trim(),
      publishedAt: date,
      publisher: article.domain.trim().replace(/^www\./, ""),
      url: url.href,
    }];
  });
}

export async function gdeltNewsForEquity(
  equity: Equity,
): Promise<ResearchSection<NewsItem[]>> {
  // Context search requires the terms in the same sentence, which keeps broad
  // company names relevant without relying on an ambiguous ticker alone.
  const qualifier = equity.assetType === "etf"
    ? "(ETF OR fund)"
    : "(stock OR shares OR company)";
  const query = `${equity.name} ${qualifier}`;
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    maxrecords: "20",
    format: "json",
    timespan: "1month",
  });
  try {
    const response = await fetch(`${GDELT_CONTEXT_API}?${params}`, {
      headers: { "User-Agent": "Henar/1.0 (https://henarapp.vercel.app)" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
    const items = parseGdeltArticles(await response.json());
    if (!items.length) throw new Error("GDELT returned no matching articles");
    return {
      status: "available",
      data: items,
      asOf: new Date().toISOString(),
      sourceUrl: GDELT_SOURCE,
    };
  } catch {
    return { status: "unavailable", data: null, asOf: null, sourceUrl: null };
  }
}
