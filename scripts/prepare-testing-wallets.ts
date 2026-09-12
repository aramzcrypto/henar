import { mkdir, readFile, writeFile, stat, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { parseEnv } from "node:util";
async function main() {
  const folder = resolve(".secrets");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  const roles = ["program", "admin", "solver", "treasury"] as const;
  const entries: Record<string, { address: string; file: string }> = {};
  for (const role of roles) {
    const file = resolve(folder, `${role}.keypair.json`);
    let pair: Keypair;
    try {
      const mode = (await stat(file)).mode;
      if (mode & 0o077) throw new Error("Existing key file must be private");
      pair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(await readFile(file, "utf8"))),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      pair = Keypair.generate();
      await writeFile(file, JSON.stringify([...pair.secretKey]), {
        flag: "wx",
        mode: 0o600,
      });
    }
    entries[role] = { address: pair.publicKey.toBase58(), file };
  }
  const envFile = resolve(".env.local");
  let source = "";
  try {
    source = await readFile(envFile, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const current = parseEnv(source);
  const wanted: Record<string, string> = {
    STOCKROOM_PROGRAM_ID: entries.program.address,
    STOCKROOM_PROGRAM_KEYPAIR_PATH: entries.program.file,
    STOCKROOM_ADMIN_KEYPAIR_PATH: entries.admin.file,
    SOLVER_KEYPAIR_PATH: entries.solver.file,
    STOCKROOM_TREASURY_OWNER: entries.treasury.address,
    STOCKROOM_VAULT: "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E",
  };
  wanted.SOLVER_STATE_DIR = resolve("solver-state");
  wanted.SOLVER_MAX_SETTLEMENT_USDC_BASE_UNITS = "100000000";
  wanted.SOLVER_ROUTE_STOCKS = "true";
  for (const [name, value] of Object.entries(wanted)) {
    if (current[name] && current[name] !== value)
      throw new Error(`Existing ${name} differs; refusing to replace it.`);
    source =
      source
        .split("\n")
        .filter((line) => !line.startsWith(name + "="))
        .join("\n")
        .trimEnd() +
      "\n" +
      name +
      "=" +
      JSON.stringify(value) +
      "\n";
  }
  await writeFile(envFile, source, { mode: 0o600 });
  await chmod(envFile, 0o600);
  await writeFile(
    resolve(folder, "public-addresses.json"),
    JSON.stringify(entries, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(entries).map(([role, v]) => [role, v.address]),
      ),
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Wallet setup failed");
  process.exitCode = 1;
});
