/**
 * On-chain pool verification (registry ONCHAIN_VERIFIED pass). RPC-gated.
 * Rewrites src/data/router/pools.json with the outcome for every pool.
 *
 *   npm run router:verify:pools           (enabled pools only)
 *   npm run router:verify:pools -- --all  (every record)
 */
import { readFile, writeFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import { verifyPoolsOnchain, type VerifiedPool } from "@henar/router-core";

const FILE = "src/data/router/pools.json";

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required for on-chain verification.");
  const all = process.argv.includes("--all");
  const pools = JSON.parse(await readFile(FILE, "utf8")) as VerifiedPool[];
  const targets = pools.filter((p) => all || p.enabled);
  const { at, outcomes, updated } = await verifyPoolsOnchain(new Connection(rpc, "confirmed"), targets);
  const byAddress = new Map(updated.map((p) => [p.address, p]));
  const merged = pools.map((p) => byAddress.get(p.address) ?? p);
  await writeFile(FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  const ok = outcomes.filter((o) => o.verification === "ONCHAIN_VERIFIED").length;
  process.stdout.write(`${at}: ${ok}/${outcomes.length} pools ONCHAIN_VERIFIED\n`);
  for (const o of outcomes.filter((o) => o.verification !== "ONCHAIN_VERIFIED")) process.stdout.write(`  FAILED ${o.address}: ${o.detail}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
