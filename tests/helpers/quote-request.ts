import { generateKeyPairSync, sign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { quoteAccessMessage } from "../../src/lib/wallet-access";
/** Real ephemeral proof: authenticated route tests still exercise signature verification. */
export function quoteRequest(body: Record<string, unknown>) {
  const keys = generateKeyPairSync("ed25519");
  const owner = new PublicKey(
    keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ).toBase58();
  const issuedAt = Date.now(),
    origin = "http://localhost";
  const signature = sign(
    null,
    Buffer.from(quoteAccessMessage(origin, owner, issuedAt)),
    keys.privateKey,
  ).toString("base64");
  return new Request(origin + "/api/market", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Bearer " +
        Buffer.from(
          JSON.stringify({ wallet: owner, issuedAt, signature }),
        ).toString("base64"),
    },
    body: JSON.stringify({ ...body, owner }),
  });
}
