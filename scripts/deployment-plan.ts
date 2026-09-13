import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Connection, Keypair } from "@solana/web3.js";
import { assertMainnet } from "../src/lib/solana";
import { DEVELOPMENT_PROGRAM } from "../src/lib/protocol/client";
import { safeError } from "../src/lib/protocol/errors";
import idl from "../src/data/stockroom-idl.json";
async function main() {
  const elf = await readFile("target/deploy/stockroom.so");
  const c = new Connection(
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  await assertMainnet(c);
  const sizes = {
    program: 36,
    programData: elf.length + 45,
    buffer: elf.length + 37,
  };
  const rents = Object.fromEntries(
    await Promise.all(
      Object.entries(sizes).map(async ([name, size]) => [
        name,
        await c.getMinimumBalanceForRentExemption(size),
      ]),
    ),
  );
  const keyfile = process.env.STOCKROOM_PROGRAM_KEYPAIR_PATH;
  let keyMatches = false;
  if (keyfile) {
    if ((await stat(keyfile)).mode & 0o077)
      throw new Error("Program key file must have permissions 0600.");
    const key = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(keyfile, "utf8"))),
    );
    keyMatches = key.publicKey.toBase58() === idl.address;
    if (!keyMatches)
      throw new Error(
        "Program key address differs from build IDL. Update public address and rebuild first.",
      );
  }
  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        program: idl.address,
        placeholder: idl.address === DEVELOPMENT_PROGRAM,
        keyMatches,
        binaryBytes: elf.length,
        sha256: createHash("sha256").update(elf).digest("hex"),
        rentLamports: rents,
        persistentRentLamports: rents.program + rents.programData,
        initialDeploymentRentLamports: rents.program + rents.programData,
        cliBufferFundingLamports: rents.programData,
        conservativePeakRentLamports:
          rents.program + rents.programData * 2,
        excludes:
          "Network fees, initialization accounts, solver funding. Agave 2.3.13 first deployment reuses the funded buffer for ProgramData rent. The conservative peak covers separately funded buffers, such as upgrades while the existing program remains funded.",
        deployCommand:
          "solana program deploy target/deploy/stockroom.so --program-id <local-program-key-file> --upgrade-authority <local-admin-key-file> --fee-payer <local-admin-key-file> --url <mainnet-rpc> --max-len <binaryBytes> --use-rpc",
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
