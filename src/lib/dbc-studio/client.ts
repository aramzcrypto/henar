/**
 * Client-side checks on a DBC Studio deployment before any keypair or wallet
 * signs it. Mirrors the router's transaction validator in intent: the bytes
 * the server returned must be exactly a config-and-pool creation for the
 * keys this browser generated, paid by this wallet, touching only the
 * programs such a creation touches.
 */
import { PublicKey, Transaction } from "@solana/web3.js";

export const STUDIO_PROGRAMS = new Set([
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", // Meteora DBC
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", // Metaplex token metadata
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
]);

const fail = (why: string) => {
  throw new Error(`Deployment transaction does not match the review (${why}). Nothing was signed.`);
};

export function validateStudioDeployment(
  serialized: string,
  expected: { payer: string; configAddress: string; baseMint: string; poolCreator?: string },
): Transaction {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(serialized, "base64"));
  } catch {
    return fail("not a legacy transaction");
  }
  if (!tx.feePayer || tx.feePayer.toBase58() !== expected.payer) fail("payer");
  if (tx.signatures.some((s) => s.signature !== null)) fail("presigned");
  const allowedSigners = new Set([expected.payer, expected.configAddress, expected.baseMint, expected.poolCreator ?? expected.payer]);
  let touchesConfig = false;
  let touchesMint = false;
  let dbcInstructions = 0;
  for (const ix of tx.instructions) {
    const program = ix.programId.toBase58();
    if (!STUDIO_PROGRAMS.has(program)) fail(`program ${program}`);
    if (program === "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN") dbcInstructions += 1;
    for (const key of ix.keys) {
      const k = key.pubkey.toBase58();
      if (key.isSigner && !allowedSigners.has(k)) fail(`foreign signer ${k}`);
      if (k === expected.configAddress) touchesConfig = true;
      if (k === expected.baseMint) touchesMint = true;
    }
  }
  if (!dbcInstructions) fail("no DBC instruction");
  if (!touchesConfig) fail("config account absent");
  if (!touchesMint) fail("base mint absent");
  void PublicKey;
  return tx;
}
