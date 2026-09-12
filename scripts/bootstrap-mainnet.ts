import { readFile, stat } from "node:fs/promises";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { assertMainnet } from "../src/lib/solana";
import {
  program,
  pda,
  integer,
  ata,
  USDC_KEY,
  DEVELOPMENT_PROGRAM,
} from "../src/lib/protocol/client";
import { vaultState } from "../src/lib/protocol/kamino";
import { Dispatcher } from "../services/solver/transactions";
import { z } from "zod";
import rawIdl from "../src/data/stockroom-idl.json";
const manifestSchema = z.object({
  version: z.string().regex(/^\d+$/),
  usdcFeed: z.string().regex(/^[0-9a-f]{64}$/),
  stocks: z
    .array(
      z.object({
        mint: z.string(),
        tokenProgram: z.string(),
        feed: z.string().regex(/^[0-9a-f]{64}$/),
        ratioNumerator: z.string().regex(/^\d+$/),
        ratioDenominator: z.string().regex(/^\d+$/),
        decimals: z.number().int(),
        packEligible: z.boolean(),
      }),
    )
    .min(1)
    .max(64),
});
async function main() {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile("config/mainnet-manifest.json", "utf8")),
  );
  const plan = {
    program: process.env.STOCKROOM_PROGRAM_ID ?? "awaiting deployment address",
    vault:
      process.env.STOCKROOM_VAULT ??
      "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
    treasuryOwner:
      process.env.STOCKROOM_TREASURY_OWNER ?? "awaiting treasury wallet",
    stocks: manifest.stocks.length,
    yieldShareBps: 1000,
    packFeeBps: 200,
    tradeFeeBps: 25,
    pausedAfterSetup: true,
  };
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (
    !process.env.SOLANA_RPC_URL ||
    !process.env.STOCKROOM_PROGRAM_ID ||
    !process.env.STOCKROOM_TREASURY_OWNER ||
    !process.env.STOCKROOM_ADMIN_KEYPAIR_PATH
  )
    throw new Error(
      "RPC, deployed program, treasury owner and local admin key file are required.",
    );
  if (
    plan.program === DEVELOPMENT_PROGRAM &&
    DEVELOPMENT_PROGRAM === "8uf1J8kvptnT4Bq84GaQG9zHmgPQgVKz6WWfYpvuA11B"
  )
    throw new Error(
      "Replace the development program ID before building and deploying.",
    );
  if (plan.program !== rawIdl.address)
    throw new Error("Program ID does not match the generated build IDL.");
  const keyfile = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH;
  if ((await stat(keyfile)).mode & 0o077)
    throw new Error("Admin key file must have mode 0600.");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(keyfile, "utf8"))),
  );
  const c = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
  await assertMainnet(c);
  const id = new PublicKey(plan.program),
    client = program(c, id),
    admin = signer.publicKey,
    config = pda(id, "config"),
    vault = new PublicKey(plan.vault),
    treasuryOwner = new PublicKey(plan.treasuryOwner),
    treasury = ata(treasuryOwner);
  const dispatcher = new Dispatcher(c, signer, async (signature) => {
    console.log(`Submitted: ${signature}`);
  });
  const info = await c.getAccountInfo(id);
  if (!info?.executable)
    throw new Error("Deploy the program before initializing.");
  const state = await vaultState(c, vault);
  if (
    !state.withdrawalPenaltyBps.isZero() ||
    !state.withdrawalPenaltyLamports.isZero()
  )
    throw new Error("Choose a vault without withdrawal penalties.");
  const existing = await client.account.config.fetchNullable(config);
  if (!existing) {
    const programData = PublicKey.findProgramAddressSync(
      [id.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
    await dispatcher.instructions([
      createAssociatedTokenAccountIdempotentInstruction(
        admin,
        treasury,
        treasuryOwner,
        USDC_KEY,
      ),
      await client.methods
        .initialize({
          usdcFeed: [...Buffer.from(manifest.usdcFeed, "hex")],
          yieldShareBps: 1000,
          packFeeBps: 200,
          tradeFeeBps: 25,
          maxSlippageBps: 50,
          maxConfidenceBps: 100,
          oracleMaxAge: 60,
          packTimeout: 604800,
        })
        .accountsStrict({
          admin,
          programData,
          config,
          treasury,
          vault,
          sharesMint: new PublicKey(state.sharesMint),
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ]);
  } else if (
    !existing.paused ||
    !existing.admin.equals(admin) ||
    !existing.vault.equals(vault) ||
    !existing.treasury.equals(treasury) ||
    existing.yieldShareBps !== 1000 ||
    existing.packFeeBps !== 200
  )
    throw new Error(
      "Existing configuration differs from this deployment plan.",
    );
  const version = BigInt(manifest.version),
    manifestKey = pda(id, "manifest", version);
  const stocks = manifest.stocks.map((s) => ({
    ...s,
    mint: new PublicKey(s.mint),
    tokenProgram: new PublicKey(s.tokenProgram),
    feed: [...Buffer.from(s.feed, "hex")],
    ratioNumerator: integer(s.ratioNumerator),
    ratioDenominator: integer(s.ratioDenominator),
  }));
  let uploaded = await client.account.manifest.fetchNullable(manifestKey);
  if (uploaded) {
    for (let i = 0; i < uploaded.stocks.length; i++) {
      const a = uploaded.stocks[i],
        b = stocks[i];
      if (
        !b ||
        !a.mint.equals(b.mint) ||
        !a.tokenProgram.equals(b.tokenProgram) ||
        a.decimals !== b.decimals ||
        a.packEligible !== b.packEligible ||
        !a.ratioNumerator.eq(b.ratioNumerator) ||
        !a.ratioDenominator.eq(b.ratioDenominator) ||
        Buffer.compare(Buffer.from(a.feed), Buffer.from(b.feed))
      )
        throw new Error(
          "Previously uploaded manifest differs; use a new version.",
        );
    }
  }
  for (
    let start = uploaded?.stocks.length ?? 0;
    start < stocks.length;
    start += 4
  ) {
    const chunk = stocks.slice(start, start + 4);
    const remaining = chunk.map((s) => ({
      pubkey: s.mint,
      isSigner: false,
      isWritable: false,
    }));
    const ix =
      start === 0
        ? await client.methods
            .createManifest(integer(version), chunk)
            .accountsStrict({
              admin,
              config,
              manifest: manifestKey,
              systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(remaining)
            .instruction()
        : await client.methods
            .appendManifest(chunk)
            .accountsStrict({ admin, config, manifest: manifestKey })
            .remainingAccounts(remaining)
            .instruction();
    await dispatcher.instructions([ix]);
  }
  uploaded = await client.account.manifest.fetch(manifestKey);
  if (uploaded.stocks.length !== stocks.length)
    throw new Error("Manifest is incomplete.");
  await dispatcher.instructions([
    await client.methods
      .activateManifest()
      .accountsStrict({ admin, config, manifest: manifestKey })
      .instruction(),
  ]);
  console.log(
    "Configuration and immutable manifest are initialized. Public deposits remain paused. Run preflight and the funded smoke procedure before enabling them.",
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Initialization failed");
  process.exitCode = 1;
});
