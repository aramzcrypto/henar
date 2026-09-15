/**
 * On-chain mint verification — the only writer of `src/data/router/mints.json`.
 *
 * Lives under apps/router because `.vercelignore` excludes scripts/** from the
 * Vercel upload, matching the pool verification pass.
 *
 *   npm run router:verify:mints
 *
 * Reads every known representation mint, not only those with an enabled pool:
 * partial coverage is how this became a blocker in the first place, since a
 * representation that gains a pool later would otherwise still be unverified.
 *
 * Nothing is inferred and nothing is defaulted. A mint whose account cannot be
 * read or decoded is omitted from the artifact, which leaves the
 * representation unverified and the planner refusing it. The file is sorted by
 * mint so a rerun that finds no change produces no diff.
 */
import { writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  inspectionFromAccount,
  listRouterRepresentations,
  verifiedMintFromInspection,
  type VerifiedMint,
} from "@henar/router-core";

const FILE = "src/data/router/mints.json";
const BATCH = 100;

export async function verifyMintsCli(argv = process.argv) {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) {
    if (argv.includes("--if-configured")) {
      process.stdout.write("verify-mints: SOLANA_RPC_URL not set; mint facts left as they are\n");
      return;
    }
    throw new Error("SOLANA_RPC_URL is required for on-chain mint verification.");
  }
  const connection = new Connection(rpc, "confirmed");
  const mints = [...new Set(listRouterRepresentations().map((r) => r.mint))].sort();
  const verifiedAt = new Date().toISOString();
  const rows: VerifiedMint[] = [];
  const missing: string[] = [];
  const unsupported: { mint: string; reason: string }[] = [];

  for (let i = 0; i < mints.length; i += BATCH) {
    const slice = mints.slice(i, i + BATCH);
    const [slot, infos] = await Promise.all([
      connection.getSlot("confirmed"),
      connection.getMultipleAccountsInfo(slice.map((m) => new PublicKey(m)), "confirmed"),
    ]);
    slice.forEach((mint, j) => {
      const account = infos[j];
      if (!account) {
        missing.push(mint);
        return;
      }
      let inspection;
      try {
        inspection = inspectionFromAccount(mint, account, verifiedAt);
      } catch (error) {
        // An undecodable account is not a mint we know anything about.
        missing.push(`${mint} (${(error as Error).message})`);
        return;
      }
      const row = verifiedMintFromInspection(inspection, slot, verifiedAt);
      rows.push(row);
      // Recorded either way: an unsupported mint is a verified fact, and the
      // guard refuses it on its own terms rather than on our silence.
      if (!row.supported) unsupported.push({ mint, reason: row.unsupportedReason ?? "unknown" });
    });
    process.stdout.write(`  ${Math.min(i + BATCH, mints.length)}/${mints.length} mints read\n`);
  }

  rows.sort((a, b) => (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0));
  await writeFile(FILE, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  process.stdout.write(`${verifiedAt}: ${rows.length}/${mints.length} mints verified into ${FILE}\n`);
  process.stdout.write(`  token-2022: ${rows.filter((r) => r.isToken2022).length}, with a scaled UI multiplier: ${rows.filter((r) => r.scaledUiMultiplier !== null).length}\n`);
  if (unsupported.length) {
    process.stdout.write(`  unsupported extensions on ${unsupported.length} mints:\n`);
    for (const u of unsupported.slice(0, 20)) process.stdout.write(`    ${u.mint}: ${u.reason}\n`);
  }
  if (missing.length) process.stdout.write(`  no account for ${missing.length} mints; they stay unverified\n`);
}

if (process.argv[1]?.endsWith("verify-mints-cli.ts")) {
  verifyMintsCli().catch((e) => {
    process.stderr.write(`${e}\n`);
    process.exitCode = 1;
  });
}
