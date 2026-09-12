import { tokenMetadata } from "@/lib/token-metadata";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { connection, assertMainnet, verifiedMint } from "@/lib/solana";
import { commonPayments, paymentLabel } from "@/lib/payment-tokens";
export async function GET(req: Request) {
  try {
    const mint = new PublicKey(
      new URL(req.url).searchParams.get("mint") ?? "",
    ).toBase58();
    const known = commonPayments.find((t) => t.mint === mint);
    if (known) return NextResponse.json(known);
    const c = connection();
    await assertMainnet(c);
    const data = await verifiedMint(c, mint);
    const metadata = (await tokenMetadata([mint]).catch(() => []))[0];
    return NextResponse.json(
      {
        mint,
        decimals: data.decimals,
        symbol: metadata?.symbol ?? paymentLabel(mint),
        name: metadata?.name ?? "Custom token",
        logo: metadata?.logo,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Unable to verify this mint. Check the address and RPC connection.",
      },
      { status: 400 },
    );
  }
}
