/** Read-only mainnet capture for LOCAL tests. Never sends a transaction. */
import { writeFile, mkdir } from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import manifest from "../config/mainnet-manifest.json";
import {
  program,
  pda,
  ata,
  common,
  integer,
  USDC_KEY,
} from "../src/lib/protocol/client";
import { fetchPackRoute, JUPITER_ROUTER } from "../services/solver/pack-swap";
import { assertMainnet } from "../src/lib/solana";
async function main() {
  const c = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  await assertMainnet(c);
  const pid = new PublicKey("7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E"),
    client = program(c, pid);
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(42)).publicKey; // Public TEST seed; never broadcast.
  const feeOwner = Keypair.fromSeed(new Uint8Array(32).fill(43)).publicKey;
  const config = pda(pid, "config"),
    m = pda(pid, "manifest", 1n),
    execution = pda(pid, "pack-execution"),
    batch = pda(pid, "batch", owner, 99n),
    pack = pda(pid, "pack", batch, 77n);
  const stock = manifest.stocks[0],
    mint = new PublicKey(stock.mint),
    tp = new PublicKey(stock.tokenProgram),
    destination = ata(owner, mint, tp),
    treasury = ata(feeOwner);
  const r = await fetchPackRoute(
    c,
    pack,
    owner,
    owner,
    mint,
    destination,
    9800000n,
    50,
  );
  const ix = await client.methods
    .swapPack(
      integer(r.output),
      integer(r.minimum),
      integer(BigInt(r.quotedAt)),
      r.route,
    )
    .accountsStrict({
      quoteAuthority: owner,
      execution,
      config,
      pack,
      manifest: m,
      usdc: USDC_KEY,
      packCash: ata(pack),
      treasury,
      stockMint: mint,
      ownerStock: destination,
      stockProgram: tp,
      tokenProgram: common.tokenProgram,
      jupiter: JUPITER_ROUTER,
    })
    .remainingAccounts(r.keys)
    .instruction();
  const instructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      destination,
      owner,
      mint,
      tp,
    ),
    ...r.setup,
    ix,
  ];
  const accounts: {
    address: string;
    owner: string;
    lamports: number;
    data: string;
    executable: boolean;
  }[] = [];
  const add = (
    key: PublicKey,
    owner: PublicKey,
    data: Buffer,
    lamports = 100000000,
    executable = false,
  ) =>
    accounts.push({
      address: key.toBase58(),
      owner: owner.toBase58(),
      data: data.toString("base64"),
      lamports,
      executable,
    });
  const seeds = (name: string, ...parts: Buffer[]) =>
    PublicKey.findProgramAddressSync([Buffer.from(name), ...parts], pid)[1];
  const dummy = PublicKey.default;
  add(
    config,
    pid,
    await client.coder.accounts.encode("config", {
      admin: owner,
      pendingAdmin: dummy,
      treasury,
      vault: dummy,
      sharesMint: dummy,
      activeManifest: m,
      usdcFeed: Buffer.from(manifest.usdcFeed, "hex"),
      yieldShareBps: 1000,
      packFeeBps: 200,
      tradeFeeBps: 25,
      maxSlippageBps: 50,
      maxConfidenceBps: 100,
      oracleMaxAge: 60,
      packTimeout: 3600,
      paused: false,
      bump: seeds("config"),
    }),
  );
  add(
    m,
    pid,
    await client.coder.accounts.encode("manifest", {
      config,
      sealed: true,
      version: integer(1),
      stocks: [
        {
          mint,
          tokenProgram: tp,
          feed: Buffer.from(stock.feed, "hex"),
          ratioNumerator: integer(stock.ratioNumerator),
          ratioDenominator: integer(stock.ratioDenominator),
          decimals: stock.decimals,
          packEligible: true,
        },
      ],
      createdAt: integer(r.quotedAt),
      bump: seeds("manifest", integer(1).toArrayLike(Buffer, "le", 8)),
    }),
  );
  add(
    execution,
    pid,
    await client.coder.accounts.encode("packExecution", {
      authority: owner,
      enabled: true,
      maxBudget: integer(40000000),
      bump: seeds("pack-execution"),
    }),
  );
  add(
    pack,
    pid,
    await client.coder.accounts.encode("pack", {
      owner,
      batch,
      config,
      manifest: m,
      index: integer(77),
      force: Array(32).fill(7),
      unitFee: integer(200000),
      slippageBps: 50,
      stockIndex: 0,
      source: { purchased: {} },
      status: { selected: {} },
      unitsReceived: integer(0),
      uiMultiplierBits: integer("4607182418800017408"),
      stockValue: integer(0),
      createdAt: integer(r.quotedAt),
      expiresAt: integer(r.quotedAt + 3600),
      settledAt: integer(0),
      lucky: false,
      round: 0,
      stake: integer(0),
      budget: integer(9800000),
      bump: seeds(
        "pack",
        batch.toBuffer(),
        integer(77).toArrayLike(Buffer, "le", 8),
      ),
    }),
  );
  const cash = (owner: PublicKey, amount: bigint) => {
    const data = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(
      {
        mint: USDC_KEY,
        owner,
        amount,
        delegateOption: 0,
        delegate: dummy,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: dummy,
      },
      data,
    );
    return data;
  };
  add(ata(pack), TOKEN_PROGRAM_ID, cash(pack, 10000000n));
  add(treasury, TOKEN_PROGRAM_ID, cash(feeOwner, 0n));
  const exclude = new Set([
    ...accounts.map((a) => a.address),
    owner.toBase58(),
    destination.toBase58(),
    pid.toBase58(),
    "11111111111111111111111111111111",
    "SysvarRent111111111111111111111111111111111",
    "SysvarC1ock11111111111111111111111111111111",
    "Sysvar1nstructions1111111111111111111111111",
    TOKEN_PROGRAM_ID.toBase58(),
  ]);
  const keys = [
    ...new Map(
      instructions
        .flatMap((i) => [i.programId, ...i.keys.map((a) => a.pubkey)])
        .map((k) => [k.toBase58(), k]),
    ).values(),
  ].filter((k) => !exclude.has(k.toBase58()));
  const infos = await c.getMultipleAccountsInfo(keys);
  for (let i = 0; i < keys.length; i++) {
    const info = infos[i];
    if (info)
      add(keys[i], info.owner, info.data, info.lamports, info.executable);
  }
  const executable = [...accounts.filter((a) => a.executable)];
  for (const entry of executable) {
    if (entry.owner !== "BPFLoaderUpgradeab1e11111111111111111111111") continue;
    const bytes = Buffer.from(entry.data, "base64");
    if (bytes.readUInt32LE(0) !== 2) throw Error("Unexpected program layout");
    const key = new PublicKey(bytes.subarray(4, 36)),
      data = await c.getAccountInfo(key);
    if (!data) throw Error("Missing program data");
    add(key, data.owner, data.data, data.lamports, data.executable);
  }
  const epoch = await c.getEpochInfo();
  await mkdir(".cache", { recursive: true });
  await writeFile(
    ".cache/pack-swap-snapshot.json",
    JSON.stringify({
      slot: epoch.absoluteSlot,
      epoch: epoch.epoch,
      timestamp: r.quotedAt,
      pack: pack.toBase58(),
      destination: destination.toBase58(),
      treasury: treasury.toBase58(),
      minimum: r.minimum.toString(),
      output: r.output.toString(),
      ticker: stock.ticker,
      accounts,
      instructions: instructions.map((i) => ({
        programId: i.programId.toBase58(),
        keys: i.keys.map((a) => ({ ...a, pubkey: a.pubkey.toBase58() })),
        data: i.data.toString("base64"),
      })),
    }),
  );
  console.log(
    JSON.stringify({
      mode: "read-only local-test snapshot",
      ticker: stock.ticker,
      accounts: accounts.length,
      routeAccounts: r.keys.length,
      minimum: r.minimum.toString(),
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Snapshot failed");
  process.exitCode = 1;
});
