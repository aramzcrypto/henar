import type { EquityResearch, NewsItem, ResearchSection } from "./types";

const sections = [
  "profile",
  "financials",
  "earnings",
  "dividends",
  "filings",
] as const;
type CachedSection = (typeof sections)[number];
type CacheRow = {
  section: CachedSection;
  payload: unknown;
  source_url: string;
  source_as_of: string | null;
};

function credentials() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url?.startsWith("https://") && key ? { url, key } : null;
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function readResearchCache(
  ticker: string,
): Promise<EquityResearch | null> {
  const auth = credentials();
  if (!auth) return null;
  try {
    const query = new URLSearchParams({
      ticker: `eq.${ticker}`,
      expires_at: `gt.${new Date().toISOString()}`,
      select: "section,payload,source_url,source_as_of",
    });
    const response = await fetch(
      `${auth.url}/rest/v1/company_research_cache?${query}`,
      { headers: headers(auth.key), cache: "no-store" },
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as CacheRow[];
    const found = new Map(rows.map((row) => [row.section, row]));
    if (!sections.some((section) => found.has(section))) return null;
    const section = <T>(name: CachedSection): ResearchSection<T> => {
      const row = found.get(name);
      return row
        ? {
            status: "available",
            data: row.payload as T,
            asOf: row.source_as_of,
            sourceUrl: row.source_url,
          }
        : { status: "unavailable", data: null, asOf: null, sourceUrl: null };
    };
    return {
      profile: section("profile"),
      financials: section("financials"),
      earnings: section("earnings"),
      dividends: section("dividends"),
      filings: section("filings"),
      news: { status: "unavailable", data: null, asOf: null, sourceUrl: null },
    };
  } catch {
    return null;
  }
}

export async function writeResearchCache(
  ticker: string,
  research: EquityResearch,
) {
  const auth = credentials();
  if (!auth) return;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const rows = sections.flatMap((name) => {
    const value = research[name];
    return value.status === "available" && value.sourceUrl
      ? [
          {
            ticker,
            section: name,
            payload: value.data,
            source_url: value.sourceUrl,
            source_as_of: value.asOf,
            fetched_at: new Date().toISOString(),
            expires_at: expiresAt,
          },
        ]
      : [];
  });
  if (!rows.length) return;
  try {
    await fetch(
      `${auth.url}/rest/v1/company_research_cache?on_conflict=ticker,section`,
      {
        method: "POST",
        headers: {
          ...headers(auth.key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
        cache: "no-store",
      },
    );
  } catch {
    // Source data can still be served when the cache is temporarily unavailable.
  }
}

type NewsRow = {
  id: number;
  headline: string;
  publisher: string;
  article_url: string;
  published_at: string;
};

export async function readNewsCache(
  ticker: string,
): Promise<ResearchSection<NewsItem[]> | null> {
  const auth = credentials();
  if (!auth) return null;
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const query = new URLSearchParams({
      ticker: `eq.${ticker}`,
      published_at: `gte.${since}`,
      select: "id,headline,publisher,article_url,published_at",
      order: "published_at.desc",
      limit: "20",
    });
    const response = await fetch(`${auth.url}/rest/v1/company_news?${query}`, {
      headers: headers(auth.key),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as NewsRow[];
    if (!rows.length) return null;
    return {
      status: "available",
      data: rows.map((row) => ({
        id: String(row.id),
        headline: row.headline,
        publisher: row.publisher,
        url: row.article_url,
        publishedAt: row.published_at,
      })),
      asOf: rows[0].published_at,
      sourceUrl: "https://www.gdeltproject.org/",
    };
  } catch {
    return null;
  }
}

export async function writeNewsCache(ticker: string, items: NewsItem[]) {
  const auth = credentials();
  if (!auth || !items.length) return;
  try {
    await fetch(`${auth.url}/rest/v1/company_news?on_conflict=ticker,article_url`, {
      method: "POST",
      headers: {
        ...headers(auth.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(items.map((item) => ({
        ticker,
        headline: item.headline,
        publisher: item.publisher,
        article_url: item.url,
        published_at: item.publishedAt,
        source_feed: "gdelt",
        ingested_at: new Date().toISOString(),
      }))),
      cache: "no-store",
    });
  } catch {
    // News remains available for the current request if persistence fails.
  }
}
