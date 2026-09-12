import { Wallet } from "@coral-xyz/anchor";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { TransactionBuilder } from "@pythnetwork/solana-utils";
import { fetchPrices } from "../services/solver/oracles";
import { mkdir, writeFile } from "node:fs/promises";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { vaultAccounts, KVAULT, KLEND } from "../src/lib/protocol/kamino";
import { assertMainnet } from "../src/lib/solana";
import {
  PROGRAM_ID as ORAO,
  networkStateAccountAddress,
  Orao,
} from "@orao-network/solana-vrf";
async function main() {
  const c = new Connection(
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  await assertMainnet(c);
  const vault = new PublicKey(
    process.env.STOCKROOM_VAULT ??
      "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
  );
  const owner = PublicKey.default;
  const v = await vaultAccounts(c, vault, owner);
  const epoch = await c.getEpochInfo();
  // Deterministic, publicly known TEST wallet; never broadcast any generated transaction.
  const testOwner = Keypair.fromSeed(new Uint8Array(32).fill(42));
  const receiver = new PythSolanaReceiver({
    connection: c,
    wallet: new Wallet(testOwner),
  });
  const usdcFeed =
    "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
  const withPrices = process.argv.includes("--with-prices");
  const posted = withPrices
    ? await receiver.buildPostPriceUpdateInstructions(
        (await fetchPrices([usdcFeed])).binary,
      )
    : { postInstructions: [], priceFeedIdToPriceUpdateAccount: {} };
  const builder = new TransactionBuilder(testOwner.publicKey, c);
  builder.addInstructions(posted.postInstructions);
  const priceTransactions = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 1000,
  });
  const network = await new Orao({ connection: c }).getNetworkState();
  const keys = new Map(
    [...v.deposit, ...v.withdraw].map((a) => [a.pubkey.toBase58(), a.pubkey]),
  );
  keys.set(ORAO.toBase58(), ORAO);
  keys.set(
    networkStateAccountAddress().toBase58(),
    networkStateAccountAddress(),
  );
  keys.set(network.config.treasury.toBase58(), network.config.treasury);
  for (const item of posted.postInstructions) {
    keys.set(item.instruction.programId.toBase58(), item.instruction.programId);
    for (const a of item.instruction.keys)
      keys.set(a.pubkey.toBase58(), a.pubkey);
  }
  // Standard system/sysvar/SPL programs come from the validator; snapshot upstream programs and state.
  const excluded = new Set([
    testOwner.publicKey.toBase58(),
    "SysvarRent111111111111111111111111111111111",
    "SysvarC1ock11111111111111111111111111111111",
    owner.toBase58(),
    v.deposit[6].pubkey.toBase58(),
    v.deposit[7].pubkey.toBase58(),
    "11111111111111111111111111111111",
    "Sysvar1nstructions1111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ]);
  const addresses = [...keys.values()].filter(
    (k) => !excluded.has(k.toBase58()),
  );
  const info = await c.getMultipleAccountsInfo(addresses);
  const accounts: {
    address: string;
    lamports: number;
    owner: string;
    data: string;
    executable: boolean;
    rentEpoch?: number;
  }[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const a = info[i];
    if (a)
      accounts.push({
        address: addresses[i].toBase58(),
        ...a,
        owner: a.owner.toBase58(),
        data: a.data.toString("base64"),
      });
  }
  for (const pid of [
    KVAULT,
    KLEND,
    ORAO,
    ...(withPrices
      ? [receiver.receiver.programId, receiver.wormhole.programId]
      : []),
  ]) {
    const a = accounts.find((a) => a.address === pid.toBase58());
    if (!a) throw new Error("Missing upstream program.");
    const bytes = Buffer.from(a.data, "base64");
    if (a.owner === "BPFLoader2111111111111111111111111111111111") continue;
    if (bytes.readUInt32LE(0) !== 2)
      throw new Error("Unexpected upgradeable program layout.");
    const pd = new PublicKey(bytes.subarray(4, 36));
    const data = await c.getAccountInfo(pd);
    if (!data) throw new Error("Missing deployed program data.");
    accounts.push({
      address: pd.toBase58(),
      ...data,
      owner: data.owner.toBase58(),
      data: data.data.toString("base64"),
    });
  }
  await mkdir(".cache/mainnet-snapshot", { recursive: true });
  const meta = (a: (typeof v.deposit)[number]) => ({
    pubkey: a.pubkey.toBase58(),
    isWritable: a.isWritable,
  });
  await writeFile(
    ".cache/mainnet-snapshot/accounts.json",
    JSON.stringify({
      pyth: withPrices
        ? {
            feed: usdcFeed,
            accounts: Object.fromEntries(
              Object.entries(posted.priceFeedIdToPriceUpdateAccount).map(
                ([feed, key]) => [feed, key.toBase58()],
              ),
            ),
            programs: [
              receiver.receiver.programId.toBase58(),
              receiver.wormhole.programId.toBase58(),
            ],
            transactions: priceTransactions.map((item) => ({
              transaction: Buffer.from(item.tx.serialize()).toString("base64"),
              testSigners: item.signers.map((s) => [...s.secretKey]),
            })),
          }
        : undefined,
      vault: vault.toBase58(),
      slot: epoch.absoluteSlot,
      epoch: epoch.epoch,
      timestamp: Math.floor(Date.now() / 1000),
      remaining: v.deposit.slice(13).map(meta),
      withdraw: v.withdraw.map(meta),
      accounts,
    }),
  );
  console.log(
    JSON.stringify({
      vault: vault.toBase58(),
      accounts: accounts.length,
      slot: epoch.absoluteSlot,
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Snapshot failed");
  process.exitCode = 1;
});
