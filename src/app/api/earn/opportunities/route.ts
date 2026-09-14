import { NextResponse } from "next/server";
import { loadStockEarnCatalog } from "@/lib/equities/earn/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await loadStockEarnCatalog();
  return NextResponse.json(catalog, {
    headers: {
      "Cache-Control":
        "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
