import { createPublicKey, verify } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { ROUTER } from "./route-policy";
export function assertApplicationRelay(encoded: string, protocolId?: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
  if (
    tx.message.header.numRequiredSignatures !== 1 ||
    tx.signatures.length !== 1
  )
    throw new Error("Unsupported relay signer set.");
  const owner = tx.message.staticAccountKeys[0];
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      owner.toBuffer(),
    ]),
    format: "der",
    type: "spki",
  });
  if (!verify(null, tx.message.serialize(), key, tx.signatures[0]))
    throw new Error("A valid wallet signature is required.");
  const allowed = new Set([ROUTER, ...(protocolId ? [protocolId] : [])]);
  if (
    !tx.message.compiledInstructions.some((ix) =>
      allowed.has(tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58()),
    )
  )
    throw new Error("Only Henar application transactions can use this relay.");
}
