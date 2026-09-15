/**
 * Meteora DLMM pool discovery for the verified equity universe.
 *
 * Meteora's HTTP pair endpoints did not return any equity pairs during
 * inspection, so this reads program accounts directly through the official
 * SDK (`DLMM.getLbPairs`) and keeps only pairs whose two mints are exactly a
 * registry mint and USDC. That makes the result authoritative rather than a
 * guess from an index that may lag.
 *
 * Requires SOLANA_RPC_URL. Without it the script writes nothing and exits
 * non-zero: an empty file would read as "no pools exist", which is not known.
 */
import { writeFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import { equityRegistry } from "../../src/lib/equities/registry";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUTPUT = "src/data/router/meteora-discovery.json";

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required for DLMM discovery.");

  const verified = new Map<
    string,
    { representationId: string; provider: string; tokenSymbol: string }
  >();
  for (const equity of equityRegistry)
    for (const r of equity.representations)
      if (r.providerStatus === "verified")
        verified.set(r.mint, {
          representationId: r.id,
          provider: r.provider,
          tokenSymbol: r.tokenSymbol,
        });

  // The package is CommonJS and exports the class as both default and DLMM.
  const mod = await import("@meteora-ag/dlmm");
  const DLMM = (mod.default ?? mod) as typeof import("@meteora-ag/dlmm").default;

  const connection = new Connection(rpc, "confirmed");
  process.stdout.write("Reading every DLMM lbPair account…\n");
  const pairs = await DLMM.getLbPairs(connection, { cluster: "mainnet-beta" });
  process.stdout.write(`  ${pairs.length} pairs on chain\n`);

  const fetchedAt = new Date().toISOString();
  const rows = new Map<
    string,
    {
      mint: string;
      representationId: string;
      provider: string;
      tokenSymbol: string;
      pairs: {
        address: string;
        tokenXMint: string;
        tokenYMint: string;
        binStep: number;
        baseFeeBps: number | null;
      }[];
      fetchedAt: string;
      error: null;
    }
  >();
  for (const [mint, rep] of verified)
    rows.set(mint, { mint, ...rep, pairs: [], fetchedAt, error: null });

  for (const pair of pairs) {
    const x = pair.account.tokenXMint.toBase58();
    const y = pair.account.tokenYMint.toBase58();
    const mint = x === USDC ? y : y === USDC ? x : null;
    if (!mint) continue;
    const row = rows.get(mint);
    if (!row) continue;
    const baseFactor = pair.account.parameters?.baseFactor;
    const binStep = pair.account.binStep;
    // base fee = baseFactor * binStep * 1e-6 (documented DLMM formula)
    const baseFeeBps =
      typeof baseFactor === "number" && typeof binStep === "number"
        ? Math.round((baseFactor * binStep) / 100)
        : null;
    row.pairs.push({
      address: pair.publicKey.toBase58(),
      tokenXMint: x,
      tokenYMint: y,
      binStep,
      baseFeeBps,
    });
  }

  const out = [...rows.values()].sort((a, b) => a.mint.localeCompare(b.mint));
  await writeFile(OUTPUT, `${JSON.stringify(out)}\n`, "utf8");
  const withPairs = out.filter((r) => r.pairs.length).length;
  process.stdout.write(
    `Wrote ${OUTPUT}: ${out.length} mints, ${withPairs} with DLMM pairs.\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
