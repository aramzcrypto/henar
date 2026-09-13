import { NextResponse } from "next/server";
import { equityForTicker } from "@/lib/equities/registry";
import { aggregatePoolLiquidity } from "@/lib/execution/liquidity";
import { USDC } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const equity = equityForTicker((await params).ticker);
  if (!equity)
    return NextResponse.json({ error: "Equity not found." }, { status: 404 });
  const settled = await Promise.all(
    equity.representations.map(async (representation) => ({
      representationId: representation.id,
      tokenSymbol: representation.tokenSymbol,
      mint: representation.mint,
      ...(await aggregatePoolLiquidity(USDC, representation.mint)),
    })),
  );
  return NextResponse.json(
    { equity: equity.ticker, representations: settled },
    {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
