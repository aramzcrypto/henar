import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { tokenMetadata } from "@/lib/token-metadata";
export async function GET(request: Request) {
  let mints: string[];
  try {
    const query = new URL(request.url).searchParams.get("mints") ?? "";
    const values = query.split(",");
    if (values.length > 100 || !query) throw Error();
    mints = values.map((v) => new PublicKey(v).toBase58());
  } catch {
    return NextResponse.json(
      { error: "Provide up to 100 token mint addresses." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await tokenMetadata(mints), {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Token metadata unavailable." },
      { status: 503 },
    );
  }
}
