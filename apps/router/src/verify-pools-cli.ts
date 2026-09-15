/**
 * On-chain pool verification (registry ONCHAIN_VERIFIED pass). RPC-gated.
 *
 * Lives under apps/router because `.vercelignore` excludes scripts/** from
 * the Vercel upload and this runs there as `prebuild`.
 * Rewrites src/data/router/pools.json with the outcome for every pool.
 *
 *   npm run router:verify:pools           (enabled pools only)
 *   npm run router:verify:pools -- --all  (every record)
 *
 * Also runs as `prebuild` on Vercel (`--if-configured`), so every deployed
 * artifact carries a registry verified against mainnet at build time; the
 * committed file stays DISCOVERED until a verified copy is committed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import { verifyPoolsOnchain, type VerifiedPool } from "@henar/router-core";

const FILE = "src/data/router/pools.json";

export async function verifyPoolsCli(argv = process.argv) {

  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) {
    // `--if-configured` (the prebuild hook) skips quietly where no RPC exists,
    // e.g. local builds; the registry then stays DISCOVERED and the guard
    // keeps refusing execution — fail closed, never fail the build.
    if (argv.includes("--if-configured")) {
      process.stdout.write("verify-pools: SOLANA_RPC_URL not set; registry left as DISCOVERED (LIVE_VALIDATION_PENDING)\n");
      return;
    }
    throw new Error("SOLANA_RPC_URL is required for on-chain verification.");
  }
  const all = argv.includes("--all");
  const pools = JSON.parse(await readFile(FILE, "utf8")) as VerifiedPool[];
  const targets = pools.filter((p) => all || p.enabled);
  let result: Awaited<ReturnType<typeof verifyPoolsOnchain>>;
  try {
    result = await verifyPoolsOnchain(new Connection(rpc, "confirmed"), targets);
  } catch (error) {
    // In the prebuild hook an RPC failure must not fail the deploy: the
    // registry stays DISCOVERED and the guard keeps refusing execution.
    if (argv.includes("--if-configured")) {
      process.stdout.write(`verify-pools: RPC read failed (${(error as Error).message}); registry left as DISCOVERED\n`);
      return;
    }
    throw error;
  }
  const { at, outcomes, updated } = result;
  const byAddress = new Map(updated.map((p) => [p.address, p]));
  const merged = pools.map((p) => byAddress.get(p.address) ?? p);
  await writeFile(FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  const ok = outcomes.filter((o) => o.verification === "ONCHAIN_VERIFIED").length;
  process.stdout.write(`${at}: ${ok}/${outcomes.length} pools ONCHAIN_VERIFIED\n`);
  for (const o of outcomes.filter((o) => o.verification !== "ONCHAIN_VERIFIED")) process.stdout.write(`  FAILED ${o.address}: ${o.detail}\n`);
}

if (process.argv[1]?.endsWith("verify-pools-cli.ts")) {
  verifyPoolsCli().catch((e) => {
    process.stderr.write(`${e}\n`);
    process.exitCode = 1;
  });
}
