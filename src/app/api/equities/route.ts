import { NextResponse } from "next/server";
import { z } from "zod";
import { listEquities } from "@/lib/equities/registry";
import { summarizeEquities } from "@/lib/equities/jupiter";
import { SECTORS } from "@/lib/equities/sectors";
import {
  companyActivity,
  passesLiquidity,
  type ActivityIndex,
  type CompanyActivity,
} from "@/lib/equities/onchain-activity";
import type { Equity } from "@/lib/equities/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(80).default(""),
  assetType: z.enum(["stock", "etf"]).optional(),
  provider: z.enum(["xstocks", "backpack", "ondo"]).optional(),
  sector: z.enum(SECTORS).optional(),
  liquidity: z.enum(["traded", "liquid"]).optional(),
  sort: z
    .enum([
      "ticker",
      "most-traded",
      "top-gainers",
      "top-losers",
      "most-liquid",
      "recent",
    ])
    .default("ticker"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Sorts that rank on the catalog-wide market pass.
 *
 * Gainers and losers are deliberately absent: they rank on a reference price
 * change the page summary carries and the pass does not, so awaiting the pass
 * for them would spend a cold start on a read they never consult.
 */
const LIVE_SORTS = new Set(["most-traded", "most-liquid"]);

function byActivity(
  index: ActivityIndex,
  read: (activity: CompanyActivity | undefined) => number | null,
  descending = true,
) {
  return (a: Equity, b: Equity) => {
    const left = read(index.byTicker.get(a.ticker));
    const right = read(index.byTicker.get(b.ticker));
    if (left === null && right === null) return a.ticker.localeCompare(b.ticker);
    if (left === null) return 1;
    if (right === null) return -1;
    return (descending ? right - left : left - right) || a.ticker.localeCompare(b.ticker);
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(url.searchParams));
    const matched = listEquities({
      query: input.q,
      assetType: input.assetType,
      provider: input.provider,
      sector: input.sector,
    });

    /* Ranking and the liquidity filter both need the live universe, not the
       window. One cached pass covers the whole catalog, so a ranked view is
       now ranked over every match rather than over the first page of them. */
    const needsMarket = input.liquidity !== undefined || LIVE_SORTS.has(input.sort);
    /* Scoped to the chosen issuer: with a provider filter on, "liquid" and
       "most traded" must answer about that issuer's token, not about the
       company's best token across all three. */
    const index = needsMarket
      ? await companyActivity({ provider: input.provider }).catch(() => null)
      : null;

    /* The filter excludes; ranking only reorders. So the filter needs a pass
       that read the whole catalog, and a partial one is refused: a company
       whose batch failed reads as illiquid, and nothing distinguishes that
       from a company that genuinely is. An upstream rate limit would
       otherwise return an empty list as though no market existed anywhere. */
    const filterable = index?.complete === true;

    let ranked = matched;
    if (filterable && input.liquidity)
      ranked = ranked.filter((equity) => passesLiquidity(index!.byTicker.get(equity.ticker), input.liquidity!));
    if (index) {
      if (input.sort === "most-traded") ranked = [...ranked].sort(byActivity(index, (a) => a?.volume24hUsd ?? null));
      if (input.sort === "most-liquid") ranked = [...ranked].sort(byActivity(index, (a) => a?.liquidityUsd ?? null));
    }

    const page = ranked.slice(input.offset, input.offset + input.limit);
    const items = await summarizeEquities(page);

    /* Gainers and losers rank on a reference price change, which the page
       summary carries and the activity pass does not, so they still order the
       page. The scope line says as much. */
    const availableFirst =
      (value: (item: (typeof items)[number]) => number | null, descending = true) =>
      (a: (typeof items)[number], b: (typeof items)[number]) => {
        const left = value(a),
          right = value(b);
        if (left === null && right === null) return a.ticker.localeCompare(b.ticker);
        if (left === null) return 1;
        if (right === null) return -1;
        return (descending ? right - left : left - right) || a.ticker.localeCompare(b.ticker);
      };
    if (input.sort === "top-gainers") items.sort(availableFirst((item) => item.priceChange24hPct));
    if (input.sort === "top-losers") items.sort(availableFirst((item) => item.priceChange24hPct, false));
    if (input.sort === "recent")
      items.sort((a, b) => {
        if (!a.recentlyTokenizedAt && !b.recentlyTokenizedAt) return a.ticker.localeCompare(b.ticker);
        if (!a.recentlyTokenizedAt) return 1;
        if (!b.recentlyTokenizedAt) return -1;
        return b.recentlyTokenizedAt.localeCompare(a.recentlyTokenizedAt);
      });

    const universeRanked = Boolean(index) && (input.sort === "most-traded" || input.sort === "most-liquid");
    return NextResponse.json(
      {
        items,
        total: ranked.length,
        offset: input.offset,
        limit: input.limit,
        liquidity: input.liquidity ?? null,
        /* A liquidity filter that could not read the market would silently
           show the unfiltered catalog. Saying the filter is unavailable is
           the only honest answer. */
        liquidityAvailable: input.liquidity === undefined ? null : filterable,
        /* How many matched before the liquidity filter was applied. The
           interface compares against this rather than the whole catalog: with
           a provider or sector also chosen, "75 of 1,339" would answer a
           question nobody asked. */
        matchedBeforeLiquidity: matched.length,
        rankingScope:
          input.sort === "ticker"
            ? null
            : {
                evaluated: universeRanked ? ranked.length : items.length,
                total: ranked.length,
                complete: universeRanked ? (index?.complete ?? false) : items.length === ranked.length,
              },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "Unable to load the equity universe." }, { status: 400 });
  }
}
