import { PublicKey } from "@solana/web3.js";
import { connection, assertMainnet } from "@/lib/solana";
import { DEVELOPMENT_PROGRAM, program, pda } from "./client";
/** All public reads and transaction preparation bind to verified deployed configuration. */
export async function protocolContext() {
  const configured = process.env.STOCKROOM_PROGRAM_ID;
  if (!configured || configured === DEVELOPMENT_PROGRAM)
    throw new Error("Henar mainnet deployment is not configured.");
  const c = connection();
  await assertMainnet(c);
  const programId = new PublicKey(configured);
  const info = await c.getAccountInfo(programId);
  if (!info?.executable) throw new Error("Henar program is not deployed.");
  const client = program(c, programId);
  const configKey = pda(programId, "config");
  const config = await client.account.config.fetch(configKey);
  const manifest = await client.account.manifest.fetch(config.activeManifest);
  if (!manifest.config.equals(configKey))
    throw new Error("Stock manifest configuration mismatch.");
  if (!manifest.sealed) throw new Error("Active stock manifest is not sealed.");
  return { c, client, programId, configKey, config, manifest };
}
export type ProtocolContext = Awaited<ReturnType<typeof protocolContext>>;
