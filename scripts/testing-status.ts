import { readFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { assertMainnet } from "../src/lib/solana";
async function main() {
  const c = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  await assertMainnet(c);
  const publicKeys = JSON.parse(
    await readFile(".secrets/public-addresses.json", "utf8"),
  );
  const wallets = await Promise.all(
    ["admin", "solver", "treasury"].map(async (role) => ({
      role,
      address: publicKeys[role].address,
      solLamports: await c.getBalance(new PublicKey(publicKeys[role].address)),
      usdcBaseUnits: (
        await c.getParsedTokenAccountsByOwner(
          new PublicKey(publicKeys[role].address),
          {
            mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
          },
        )
      ).value
        .reduce(
          (a, r) => a + BigInt(r.account.data.parsed.info.tokenAmount.amount),
          0n,
        )
        .toString(),
    })),
  );
  console.log(
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        mainnetVerified: true,
        lookupTableConfigured: !!process.env.STOCKROOM_LOOKUP_TABLE,
        heliusConfigured: !!process.env.SOLANA_RPC_URL,
        jupiterConfigured: !!process.env.JUPITER_API_KEY,
        pythConfigured: !!process.env.PYTH_API_KEY,
        program: publicKeys.program.address,
        deployed: !!(
          await c.getAccountInfo(new PublicKey(publicKeys.program.address))
        )?.executable,
        wallets,
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error("Testing setup status could not be verified");
  process.exitCode = 1;
});
