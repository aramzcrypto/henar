import { readFile, stat } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import { protocolContext } from "../src/lib/protocol/context";
import { Dispatcher } from "../services/solver/transactions";
async function main() {
  const paused = !process.argv.includes("--unpause");
  const ctx = await protocolContext();
  console.log(
    JSON.stringify({
      program: ctx.programId.toBase58(),
      currentPaused: ctx.config.paused,
      requestedPaused: paused,
    }),
  );
  if (!process.argv.includes("--execute")) return;
  const path = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH;
  if (!path) throw new Error("Set the local admin key file.");
  if ((await stat(path)).mode & 0o077)
    throw new Error("Admin key file must have permissions 0600.");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
  );
  if (!ctx.config.admin.equals(signer.publicKey))
    throw new Error("Admin signer does not match configuration.");
  const dispatcher = new Dispatcher(ctx.c, signer, async (signature) => {
    console.log(`Submitted: ${signature}`);
  });
  await dispatcher.instructions([
    await ctx.client.methods
      .setPaused(paused)
      .accountsStrict({ admin: signer.publicKey, config: ctx.configKey })
      .instruction(),
  ]);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Pause update failed");
  process.exitCode = 1;
});
