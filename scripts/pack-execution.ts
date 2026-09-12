/** Read-only plan by default; execute only after the program is deployed and verified. */
import { readFile, stat } from "node:fs/promises";
import { Keypair, PublicKey } from "@solana/web3.js";
import { protocolContext } from "../src/lib/protocol/context";
import { common, integer, pda } from "../src/lib/protocol/client";
import { Dispatcher } from "../services/solver/transactions";
async function main() {
  const command = process.argv[2] ?? "status";
  if (!["status", "enable", "disable"].includes(command))
    throw Error("Use status, enable or disable.");
  const ctx = await protocolContext(),
    execution = pda(ctx.programId, "pack-execution");
  const policy =
    await ctx.client.account.packExecution.fetchNullable(execution);
  const signerPath = process.env.SOLVER_KEYPAIR_PATH;
  const authority = process.env.PACK_QUOTE_AUTHORITY
    ? new PublicKey(process.env.PACK_QUOTE_AUTHORITY)
    : (policy?.authority ??
      (signerPath
        ? Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(await readFile(signerPath, "utf8"))),
          ).publicKey
        : null));
  const maximum = BigInt(
    process.env.PACK_MAX_BUDGET_USDC_BASE_UNITS ??
      policy?.maxBudget.toString() ??
      "40000000",
  );
  console.log(
    JSON.stringify(
      {
        command,
        execution: execution.toBase58(),
        authority: authority?.toBase58(),
        enabled: policy?.enabled ?? false,
        maximumBaseUnits: maximum.toString(),
        execute: process.argv.includes("--execute"),
        trust:
          "The quote authority chooses the market quote. The contract enforces custody, mint, exact budget, recipient, 30-second freshness and slippage against that quote.",
      },
      null,
      2,
    ),
  );
  if (command === "status" || !process.argv.includes("--execute")) return;
  if (!authority) throw Error("Configure the quote authority first.");
  const path = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH;
  if (!path || (await stat(path)).mode & 0o077)
    throw Error("Local admin key with permissions 0600 required.");
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
  );
  if (!admin.publicKey.equals(ctx.config.admin)) throw Error("Admin mismatch.");
  const ix = await ctx.client.methods
    .configurePackExecution(authority, command === "enable", integer(maximum))
    .accountsStrict({
      admin: admin.publicKey,
      config: ctx.configKey,
      execution,
      systemProgram: common.systemProgram,
    })
    .instruction();
  await new Dispatcher(ctx.c, admin, async (signature) => {
    console.log(`Submitted: ${signature}`);
  }).instructions([ix]);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Pack configuration failed");
  process.exitCode = 1;
});
