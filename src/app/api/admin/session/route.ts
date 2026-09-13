import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { protocolContext } from "@/lib/protocol/context";
import {
  adminMessage,
  allowedAdminWallets,
  PRIVATE_HEADERS,
  ADMIN_SESSION_MS,
} from "@/lib/admin/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("wallet") || "";
    if (raw.length > 44)
      return NextResponse.json(
        { error: "Invalid wallet." },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    const wallet = new PublicKey(raw).toBase58();
    const { config } = await protocolContext();
    if (!allowedAdminWallets(config.admin.toBase58()).includes(wallet))
      return NextResponse.json(
        { error: "This wallet does not have admin access." },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    const issuedAt = Date.now();
    return NextResponse.json(
      {
        wallet,
        issuedAt,
        expiresAt: issuedAt + ADMIN_SESSION_MS,
        message: adminMessage(url.origin, wallet, issuedAt),
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Admin sign-in is unavailable. Check the wallet and protocol connection.",
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
