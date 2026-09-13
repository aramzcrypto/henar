import { boundedJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { z } from "zod";
import { protocolContext } from "@/lib/protocol/context";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const { signature, owner } = z
      .object({
        signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
        owner: z.string(),
      })
      .parse(await boundedJson(request));
    const { c, programId } = await protocolContext();
    const tx = await c.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return NextResponse.json({ confirmed: false }, { status: 202 });
    if (tx.meta?.err) throw new Error("Transaction failed onchain.");
    const keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta?.loadedAddresses,
    });
    if (
      keys.get(0)?.toBase58() !== owner ||
      !tx.transaction.message.compiledInstructions.some((ix) =>
        keys.get(ix.programIdIndex)?.equals(programId),
      )
    )
      throw new Error("Transaction does not match Henar and this wallet.");
    return NextResponse.json({ confirmed: true, signature, slot: tx.slot });
  } catch {
    return NextResponse.json(
      { error: "Confirmation could not be verified." },
      { status: 400 },
    );
  }
}
