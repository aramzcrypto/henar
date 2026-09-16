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
/* Meteora's own DLMM data API. Chain state carries no USD value, so a pair
   discovered on chain has no liquidity number to judge it by; without one
   every DLMM pair stayed disabled as "not yet reviewed" and the venue was
   unreachable however much liquidity it actually held. This is the same
   source the private-markets discovery already trusts for TVL. */
const DATAPI = "https://dlmm.datapi.meteora.ag/pools";

type PoolMeta = { tvl: number | null; baseFeePct: number | null; blacklisted: boolean };

async function poolMeta(address: string): Promise<PoolMeta | null> {
  try {
    const response = await fetch(`${DATAPI}/${address}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      tvl?: number | null;
      pool_config?: { base_fee_pct?: number | null } | null;
      is_blacklisted?: boolean | null;
    };
    const tvl = typeof body.tvl === "number" && Number.isFinite(body.tvl) ? body.tvl : null;
    const pct = body.pool_config?.base_fee_pct;
    return {
      tvl,
      baseFeePct: typeof pct === "number" && Number.isFinite(pct) ? pct : null,
      blacklisted: body.is_blacklisted === true,
    };
  } catch {
    return null;
  }
}

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

  /* The package is CommonJS and exports the class as both default and DLMM.
     Under plain `tsx` the ESM interop fails inside the SDK's own dependency
     graph ("@coral-xyz/anchor does not provide an export named BN"), so the
     CommonJS path is tried when the ESM one throws. Same fallback the Earn
     adapter uses; without it this script cannot run outside Next's bundler
     and the discovery file never gets written. */
  const mod = await import("@meteora-ag/dlmm").catch(async () => {
    const { createRequire } = await import("node:module");
    return createRequire(import.meta.url)("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
  });
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
        /** From Meteora's data API. Null means unknown, never zero. */
        tvlUsd: number | null;
        blacklisted: boolean;
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
      tvlUsd: null,
      blacklisted: false,
    });
  }

  /* Price every discovered pair. Unknown TVL stays null rather than becoming
     zero: "we could not read it" and "there is nothing there" are different
     facts, and the registry's floor must not confuse them. */
  const all = [...rows.values()].flatMap((r) => r.pairs);
  process.stdout.write(`Reading liquidity for ${all.length} pairs from the DLMM data API…\n`);
  let priced = 0;
  for (const pair of all) {
    const meta = await poolMeta(pair.address);
    if (meta) {
      pair.tvlUsd = meta.tvl;
      pair.blacklisted = meta.blacklisted;
      if (meta.baseFeePct !== null) pair.baseFeeBps = Math.round(meta.baseFeePct * 100);
      if (meta.tvl !== null) priced += 1;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  process.stdout.write(`  ${priced} of ${all.length} pairs returned a TVL\n`);

  const out = [...rows.values()].sort((a, b) => a.mint.localeCompare(b.mint));
  await writeFile(OUTPUT, `${JSON.stringify(out)}\n`, "utf8");
  const withPairs = out.filter((r) => r.pairs.length).length;
  const liquid = out.flatMap((r) => r.pairs).filter((p) => (p.tvlUsd ?? 0) >= 1_000).length;
  process.stdout.write(
    `Wrote ${OUTPUT}: ${out.length} mints, ${withPairs} with DLMM pairs, ${liquid} pairs at or above $1,000 TVL.\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
