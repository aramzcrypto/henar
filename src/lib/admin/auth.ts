import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import { ADMIN_SESSION_MS, adminMessage } from "./message";
export { ADMIN_SESSION_MS, adminMessage } from "./message";
const proofSchema = z
  .object({
    wallet: z.string().min(32).max(44),
    issuedAt: z.number().int().nonnegative(),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export function verifyAdminProof(
  header: string | null,
  origin: string,
  allowed: string[],
  now = Date.now(),
): string | null {
  try {
    if (!header?.startsWith("Bearer ") || header.length > 1024) return null;
    const proof = proofSchema.parse(
      JSON.parse(Buffer.from(header.slice(7), "base64").toString("utf8")),
    );
    if (
      !allowed.includes(proof.wallet) ||
      proof.issuedAt > now ||
      now - proof.issuedAt >= ADMIN_SESSION_MS
    )
      return null;
    const publicKey = new PublicKey(proof.wallet);
    if (publicKey.toBase58() !== proof.wallet) return null;
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        publicKey.toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(adminMessage(origin, proof.wallet, proof.issuedAt)),
      key,
      Buffer.from(proof.signature, "base64"),
    )
      ? proof.wallet
      : null;
  } catch {
    return null;
  }
}
export function allowedAdminWallets(contractAdmin: string) {
  const configured = (process.env.HENAR_ADMIN_WALLETS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  // Dashboard roles never inherit pilot/trading permissions.
  return [
    ...new Set([
      contractAdmin,
      ...configured.map((v) => new PublicKey(v).toBase58()),
    ]),
  ];
}
export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
