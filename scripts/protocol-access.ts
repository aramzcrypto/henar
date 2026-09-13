/** Configure product flags and a cumulative pilot budget. Plan by default, never unpauses. */
import { readFile, stat } from "node:fs/promises";
import { Keypair, PublicKey } from "@solana/web3.js";
import { protocolContext } from "../src/lib/protocol/context";
import { integer } from "../src/lib/protocol/client";
import { PRODUCTS } from "../src/lib/protocol/access";
import { Dispatcher } from "../services/solver/transactions";
async function main() {
  const ctx = await protocolContext();
  const list = (process.env.PROTOCOL_PRODUCTS ?? "").split(",").filter(Boolean);
  let mask = 0;
  for (const name of list) {
    if (!(name in PRODUCTS)) throw new Error("Unknown product: " + name);
    mask |= PRODUCTS[name as keyof typeof PRODUCTS];
  }
  const pilot = new PublicKey(
    process.env.PROTOCOL_PILOT_OWNER || ctx.config.admin.toBase58(),
  );
  const cap =
    process.env.PROTOCOL_ADMISSION_LIMIT_USDC_BASE_UNITS ?? "100000000";
  if (
    !/^\d{1,20}$/.test(cap) ||
    BigInt(cap) <= 0n ||
    BigInt(cap) > (1n << 64n) - 1n ||
    BigInt(cap) < BigInt(ctx.config.admittedUsdc.toString())
  )
    throw new Error("Invalid admission cap.");
  console.log(
    JSON.stringify(
      {
        program: ctx.programId.toBase58(),
        products: list,
        pilot: pilot.toBase58(),
        cap,
        alreadyAdmitted: ctx.config.admittedUsdc.toString(),
        paused: ctx.config.paused,
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--execute")) return;
  if (!ctx.config.paused)
    throw new Error("Pause before changing access policy.");
  const path = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH;
  if (!path) throw new Error("Set the admin key file.");
  if ((await stat(path)).mode & 0o077)
    throw new Error("Admin key must have permissions 0600.");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
  );
  if (!ctx.config.admin.equals(signer.publicKey))
    throw new Error("Wrong admin signer.");
  const d = new Dispatcher(ctx.c, signer, async (signature) => {
    console.log("Submitted: " + signature);
  });
  await d.instructions([
    await ctx.client.methods
      .configureAccess(mask, pilot, integer(cap))
      .accountsStrict({ admin: signer.publicKey, config: ctx.configKey })
      .instruction(),
  ]);
}
main().catch(() => {
  console.error(
    "Access configuration failed. Check the paused policy, product list, cap and admin.",
  );
  process.exitCode = 1;
});
