import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson } from "@/lib/request-body";
import { equityForTicker } from "@/lib/equities/registry";
import { aggregateQuote } from "@/lib/equities/jupiter";
import { providerRoutes } from "@/lib/equities/company-routes";
import { dexRoute, bestNetRoute } from "@/lib/equities/routes";
import { consumePublicQuoteBudget } from "@/lib/equities/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  equity: z.string().trim().min(1).max(12),
  side: z.enum(["buy", "sell"]),
  amount: z
    .union([
      z.number().positive().max(1_000_000),
      z.string().regex(/^\d+(\.\d+)?$/),
    ])
    .transform(String),
});

export async function POST(request: Request) {
  try {
    if (!consumePublicQuoteBudget(request))
      return NextResponse.json(
        { error: "Quote limit reached. Please wait a minute." },
        {
          status: 429,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": "60",
          },
        },
      );
    const input = schema.parse(await boundedJson(request));
    const equity = equityForTicker(input.equity);
    if (!equity)
      return NextResponse.json({ error: "Equity not found." }, { status: 404 });
    const [dex, providers] = await Promise.allSettled([
      aggregateQuote(equity, input.side, input.amount),
      providerRoutes(equity),
    ]);
    const routes = [
      ...(dex.status === "fulfilled"
        ? dex.value.alternatives.map((q) => dexRoute(q, input.side))
        : []),
      ...(providers.status === "fulfilled"
        ? providers.value.routes.filter((r) => r.side === input.side)
        : []),
    ];
    if (!routes.length)
      throw new Error(
        "No executable representation is available for this amount.",
      );
    return NextResponse.json(
      {
        ...(dex.status === "fulfilled"
          ? dex.value
          : {
              equity: equity.ticker,
              side: input.side,
              selectedRepresentation: null,
              alternatives: [],
              executable: false,
            }),
        routes,
        bestRoute: bestNetRoute(routes, input.side, input.amount),
        comparisonBasis:
          "Net output after provider and Henar fees; network fees excluded. Account-gated routes without all-in quotes are not ranked.",
      },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          /No executable|too small/.test(error.message)
            ? error.message
            : "Unable to aggregate this quote.",
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
