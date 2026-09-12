import { readFile, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
async function main() {
  const value = process.argv[2];
  if (!value)
    throw new Error(
      "Pass the PUBLIC program address derived from your deployment key file.",
    );
  const id = new PublicKey(value).toBase58();
  const rustPath = "programs/stockroom/src/lib.rs",
    anchorPath = "Anchor.toml";
  const rust = await readFile(rustPath, "utf8");
  await writeFile(
    rustPath,
    rust.replace(
      /declare_id!\("[1-9A-HJ-NP-Za-km-z]+"\);/,
      `declare_id!("${id}");`,
    ),
  );
  const anchor = await readFile(anchorPath, "utf8");
  await writeFile(
    anchorPath,
    anchor.replace(
      /stockroom = "[1-9A-HJ-NP-Za-km-z]+"/g,
      `stockroom = "${id}"`,
    ),
  );
  console.log(
    `Program address set to ${id}. Run npm run contracts:build before deploying; IDL is regenerated from the build.`,
  );
}
main().catch((e) => {
  console.error(
    e instanceof Error ? e.message : "Unable to set program address",
  );
  process.exitCode = 1;
});
