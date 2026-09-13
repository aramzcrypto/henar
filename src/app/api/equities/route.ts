import { NextResponse } from "next/server";
import { z } from "zod";
import { listEquities } from "@/lib/equities/registry";
import { summarizeEquities } from "@/lib/equities/jupiter";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(80).default(""),
  assetType: z.enum(["stock", "etf"]).optional(),
  provider: z.enum(["xstocks", "backpack", "ondo"]).optional(),
  sector: z.string().max(80).optional(),
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(url.searchParams));
    const filtered = listEquities({
      query: input.q,
      assetType: input.assetType,
      provider: input.provider,
    }).filter((equity) => !input.sector || equity.sector === input.sector);
    const items = await summarizeEquities(
      filtered.slice(input.offset, input.offset + input.limit),
    );
    const availableFirst =
      (
        value: (item: (typeof items)[number]) => number | null,
        descending = true,
      ) =>
      (a: (typeof items)[number], b: (typeof items)[number]) => {
        const left = value(a),
          right = value(b);
        if (left === null && right === null)
          return a.ticker.localeCompare(b.ticker);
        if (left === null) return 1;
        if (right === null) return -1;
        return (
          (descending ? right - left : left - right) ||
          a.ticker.localeCompare(b.ticker)
        );
      };
    if (input.sort === "most-traded")
      items.sort(availableFirst((item) => item.onchainVolume24hUsd));
    if (input.sort === "most-liquid")
      items.sort(availableFirst((item) => item.liquidityUsd));
    if (input.sort === "top-gainers")
      items.sort(availableFirst((item) => item.priceChange24hPct));
    if (input.sort === "top-losers")
      items.sort(availableFirst((item) => item.priceChange24hPct, false));
    if (input.sort === "recent")
      items.sort((a, b) => {
        if (!a.recentlyTokenizedAt && !b.recentlyTokenizedAt)
          return a.ticker.localeCompare(b.ticker);
        if (!a.recentlyTokenizedAt) return 1;
        if (!b.recentlyTokenizedAt) return -1;
        return b.recentlyTokenizedAt.localeCompare(a.recentlyTokenizedAt);
      });
    return NextResponse.json(
      {
        items,
        total: filtered.length,
        offset: input.offset,
        limit: input.limit,
        rankingScope:
          input.sort === "ticker"
            ? null
            : {
                evaluated: items.length,
                total: filtered.length,
                complete: items.length === filtered.length,
              },
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to load the equity universe." },
      { status: 400 },
    );
  }
}
