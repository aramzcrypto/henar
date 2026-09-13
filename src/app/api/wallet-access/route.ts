import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { quoteAccessMessage, QUOTE_SESSION_MS } from "@/lib/wallet-access";
export function GET(request: Request) {
  const url = new URL(request.url),
    raw = url.searchParams.get("wallet") || "";
  try {
    if (raw.length > 44) throw new Error();
    const key = new PublicKey(raw);
    if (!PublicKey.isOnCurve(key.toBytes())) throw new Error();
    const wallet = key.toBase58(),
      issuedAt = Date.now();
    return NextResponse.json(
      {
        wallet,
        issuedAt,
        expiresAt: issuedAt + QUOTE_SESSION_MS,
        message: quoteAccessMessage(url.origin, wallet, issuedAt),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
