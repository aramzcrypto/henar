import { NextResponse } from "next/server";
import { z } from "zod";
import { protocolContext } from "@/lib/protocol/context";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const days = z
      .enum(["7", "30", "90"])
      .parse(new URL(request.url).searchParams.get("days") ?? "30");
    const { config } = await protocolContext();
    const end = new Date(),
      start = new Date(end.getTime() - Number(days) * 86400000);
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
    });
    const response = await fetch(
      `https://api.kamino.finance/kvaults/vaults/${config.vault}/metrics/history?${params}`,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!response.ok) throw new Error("History unavailable");
    const values = z
      .array(
        z.object({
          timestamp: z.string().datetime(),
          apyActual: z.coerce.number().finite(),
          tvl: z.coerce.number().finite().nonnegative(),
        }),
      )
      .parse(await response.json());
    const sorted = values
      .filter(
        (v) =>
          Date.parse(v.timestamp) >= start.getTime() &&
          Date.parse(v.timestamp) <= end.getTime(),
      )
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const step = Math.max(1, Math.ceil(sorted.length / 180));
    return NextResponse.json(
      {
        points: sorted
          .filter((_, i) => i % step === 0 || i === sorted.length - 1)
          .map((p) => ({
            timestamp: p.timestamp,
            apy: p.apyActual * 100,
            tvl: p.tvl,
          })),
        source: "Kamino",
        tvlCurrency: "USD",
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Verified vault history is unavailable." },
      { status: 503 },
    );
  }
}
