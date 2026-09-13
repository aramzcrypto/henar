import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { QUOTE_SESSION_MS, quoteAccessMessage } from "./wallet-access";
const schema = z
  .object({
    wallet: z.string().min(32).max(44),
    issuedAt: z.number().int().nonnegative(),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export function verifyQuoteAccess(
  request: Request,
  owner: string,
  now = Date.now(),
) {
  try {
    const origin = new URL(request.url).origin;
    if (
      request.headers.has("origin") &&
      request.headers.get("origin") !== origin
    )
      return false;
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ") || header.length > 1024) return false;
    const proof = schema.parse(
      JSON.parse(Buffer.from(header.slice(7), "base64").toString("utf8")),
    );
    if (
      proof.wallet !== owner ||
      proof.issuedAt > now ||
      now - proof.issuedAt >= QUOTE_SESSION_MS
    )
      return false;
    const key = new PublicKey(owner);
    if (!PublicKey.isOnCurve(key.toBytes())) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        key.toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(quoteAccessMessage(origin, owner, proof.issuedAt)),
      publicKey,
      Buffer.from(proof.signature, "base64"),
    );
  } catch {
    return false;
  }
}
// Supplemental instance budget; distributed enforcement and provider spend caps
// remain required at the edge. Signature checks run before consuming this budget.
export function createQuoteBudget() {
  let until = 0,
    total = 0;
  const wallets = new Map<string, number>();
  return (owner: string, now = Date.now()) => {
    if (now >= until) {
      until = now + 60_000;
      total = 0;
      wallets.clear();
    }
    const used = wallets.get(owner) || 0;
    if (total >= 120 || used >= 15) return false;
    total++;
    wallets.set(owner, used + 1);
    return true;
  };
}
export const consumeQuoteBudget = createQuoteBudget();
