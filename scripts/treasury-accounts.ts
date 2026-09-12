import { readFile, stat } from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccountLenForMint,
  unpackMint,
} from "@solana/spl-token";
import { ata, USDC_KEY } from "../src/lib/protocol/client";
import { assertMainnet } from "../src/lib/solana";
import { Dispatcher } from "../services/solver/transactions";
import { safeError } from "../src/lib/protocol/errors";
import catalog from "../src/data/stocks.json";
import manifest from "../config/mainnet-manifest.json";
async function main() {
  if (!process.env.STOCKROOM_TREASURY_OWNER)
    throw new Error(
      "Set STOCKROOM_TREASURY_OWNER to your public treasury wallet address.",
    );
  const c = new Connection(
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  await assertMainnet(c);
  const treasury = new PublicKey(process.env.STOCKROOM_TREASURY_OWNER);
  const mints = [
    USDC_KEY,
    ...(process.argv.includes("--all") ? catalog : manifest.stocks).map(
      (s) => new PublicKey(s.mint),
    ),
  ];
  const unique = [...new Map(mints.map((m) => [m.toBase58(), m])).values()];
  const missing: {
    mint: PublicKey;
    program: PublicKey;
    address: PublicKey;
    rent: number;
  }[] = [];
  for (let start = 0; start < unique.length; start += 50) {
    const chunk = unique.slice(start, start + 50),
      infos = await c.getMultipleAccountsInfo(chunk);
    for (let i = 0; i < chunk.length; i++) {
      const info = infos[i];
      if (!info) throw new Error(`Mint unavailable: ${chunk[i]}`);
      const mint = unpackMint(chunk[i], info, info.owner),
        address = ata(treasury, chunk[i], info.owner);
      if (!(await c.getAccountInfo(address)))
        missing.push({
          mint: chunk[i],
          program: info.owner,
          address,
          rent: await c.getMinimumBalanceForRentExemption(
            getAccountLenForMint(mint),
          ),
        });
    }
  }
  console.log(
    JSON.stringify(
      {
        mode: process.argv.includes("--execute") ? "execute" : "read-only",
        treasury: treasury.toBase58(),
        checked: unique.length,
        missing: missing.length,
        rentLamports: missing.reduce((n, a) => n + a.rent, 0),
        usdcFeeAccount: ata(treasury).toBase58(),
      },
      null,
      2,
    ),
  );
  if (!process.argv.includes("--execute")) return;
  const file = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH;
  if (!file)
    throw new Error("Local admin key file is required to fund account rent.");
  if ((await stat(file)).mode & 0o077)
    throw new Error("Key file must have permissions 0600.");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(file, "utf8"))),
  );
  const dispatch = new Dispatcher(c, signer, async (signature) =>
    console.log(`Submitted: ${signature}`),
  );
  for (let i = 0; i < missing.length; i += 4)
    await dispatch.instructions(
      missing
        .slice(i, i + 4)
        .map((a) =>
          createAssociatedTokenAccountIdempotentInstruction(
            signer.publicKey,
            a.address,
            treasury,
            a.mint,
            a.program,
          ),
        ),
    );
}
main().catch((e) => {
  console.error(safeError(e));
  process.exitCode = 1;
});
