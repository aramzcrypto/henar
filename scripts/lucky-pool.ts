/** Plans by default. Explicit --execute required; never automatically enables Lucky. */
import { readFile, stat } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { protocolContext } from "../src/lib/protocol/context";
import {
  pda,
  ata,
  common,
  integer,
  USDC_KEY,
} from "../src/lib/protocol/client";
import { parseUnits } from "../src/lib/amount";
import { Dispatcher } from "../services/solver/transactions";
async function main() {
  const command = process.argv[2] ?? "status";
  if (
    !["status", "initialize", "fund", "enable", "disable", "withdraw"].includes(
      command,
    )
  )
    throw new Error(
      "Use status, initialize, fund, enable, disable, or withdraw.",
    );
  const ctx = await protocolContext();
  const pool = pda(ctx.programId, "lucky-pool");
  const state = await ctx.client.account.luckyPool.fetchNullable(pool);
  const reserve = state
    ? (await ctx.c.getTokenAccountBalance(ata(pool))).value.amount
    : "0";
  const amount = process.argv
    .find((a) => a.startsWith("--amount="))
    ?.split("=")[1];
  const units = amount ? parseUnits(amount, 6) : 0n;
  const maximum = process.argv
    .find((a) => a.startsWith("--max-stake="))
    ?.split("=")[1];
  const maxStake = maximum
    ? parseUnits(maximum, 6)
    : BigInt(state?.maxStake.toString() ?? "20000000");
  console.log(
    JSON.stringify(
      {
        command,
        pool: pool.toBase58(),
        cash: ata(pool).toBase58(),
        initialized: !!state,
        enabled: state?.enabled ?? false,
        reserveBaseUnits: reserve,
        amountBaseUnits: units.toString(),
        maxStakeBaseUnits: maxStake.toString(),
        execute: process.argv.includes("--execute"),
      },
      null,
      2,
    ),
  );
  if (command === "status" || !process.argv.includes("--execute")) return;
  if (command !== "initialize" && !state)
    throw new Error("Initialize the disabled Lucky pool first.");
  if (["fund", "withdraw"].includes(command) && units <= 0n)
    throw new Error("Specify a positive --amount in USDC.");
  if (command === "enable" && (ctx.config.paused || BigInt(reserve) < maxStake))
    throw new Error(
      "Unpause the protocol and fund at least the maximum stake before enabling Lucky.",
    );
  const path = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH;
  if (!path || (await stat(path)).mode & 0o077)
    throw new Error(
      "A local admin key file with permissions 0600 is required.",
    );
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
  );
  if (!ctx.config.admin.equals(signer.publicKey))
    throw new Error("Admin authority mismatch.");
  const admin = {
    admin: signer.publicKey,
    config: ctx.configKey,
    pool,
    usdc: USDC_KEY,
    poolCash: ata(pool),
    treasury: ctx.config.treasury,
    tokenProgram: common.tokenProgram,
  };
  const ix =
    command === "initialize"
      ? await ctx.client.methods
          .initializeLucky()
          .accountsStrict({
            admin: signer.publicKey,
            config: ctx.configKey,
            pool,
            poolCash: ata(pool),
            ...common,
          })
          .instruction()
      : command === "fund"
        ? createTransferCheckedInstruction(
            ata(signer.publicKey),
            USDC_KEY,
            ata(pool),
            signer.publicKey,
            units,
            6,
          )
        : command === "withdraw"
          ? await ctx.client.methods
              .withdrawLuckyReserve(integer(units))
              .accountsStrict(admin)
              .instruction()
          : await ctx.client.methods
              .configureLucky(command === "enable", integer(maxStake))
              .accountsStrict(admin)
              .instruction();
  const dispatcher = new Dispatcher(ctx.c, signer, async (signature) => {
    console.log(`Submitted: ${signature}`);
  });
  await dispatcher.instructions([ix]);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Lucky pool operation failed");
  process.exitCode = 1;
});
