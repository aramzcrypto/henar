/**
 * Admit the USDC pools of the qualified intermediates that are not themselves
 * equity representations (SOL, USDT, ...). These are the USDC-side hop of a
 * two-leg path; without them a representation's SOL pool is real liquidity
 * the router can see and never reach.
 *
 * Source: Raydium's public pool API (HTTP, no RPC), concentrated pools only,
 * because that is the pool type with a native quote, curve and builder. Each
 * record is written as INTERMEDIATE_ROUTE under the intermediate's synthetic
 * representation id, `verification: DISCOVERED`, and enabled when TVL clears
 * the floor. The guard refuses anything not ONCHAIN_VERIFIED, so nothing
 * routes through these until the verification pass at build has read the
 * pool account and confirmed it trades the pair.
 *
 *   npm run router:discover:intermediates
 */
import { readFile, writeFile } from "node:fs/promises";
import { intermediateRepresentationId, qualifiedIntermediates, routerRepresentationForMint, validatePool, type VerifiedPool } from "@henar/router-core";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REGISTRY = "src/data/router/pools.json";
const RAYDIUM_CLMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
/** Deep markets only: a thin USDC hop would cost more than it saves. */
const MIN_TVL_USD = Number(process.env.INTERMEDIATE_MIN_TVL_USD ?? "100000");
/** Below this the pool is not even recorded: a $3 pool documents nothing. */
const RECORD_TVL_USD = 10_000;
const PER_INTERMEDIATE = 3;

type ApiPool = {
  id: string;
  programId: string;
  type: string;
  tvl: number;
  feeRate: number;
  mintA: { address: string; programId: string; decimals: number; symbol?: string };
  mintB: { address: string; programId: string; decimals: number; symbol?: string };
  config?: { id: string; tickSpacing: number };
};

async function raydiumPools(mint: string): Promise<ApiPool[]> {
  const params = new URLSearchParams({ mint1: mint, mint2: USDC, poolType: "concentrated", poolSortField: "liquidity", sortType: "desc", pageSize: "10", page: "1" });
  const res = await fetch(`https://api-v3.raydium.io/pools/info/mint?${params}`);
  if (!res.ok) throw new Error(`Raydium API ${res.status} for ${mint}`);
  const body = (await res.json()) as { success: boolean; data: { data: ApiPool[] } };
  if (!body.success) throw new Error(`Raydium API refused ${mint}`);
  return body.data.data;
}

async function main() {
  const now = new Date().toISOString();
  const registry = JSON.parse(await readFile(REGISTRY, "utf8")) as VerifiedPool[];
  const known = new Set(registry.map((p) => p.address));
  const candidates = qualifiedIntermediates().filter((a) => a.mint !== USDC && !routerRepresentationForMint(a.mint));
  const admitted: VerifiedPool[] = [];
  const skipped: string[] = [];
  for (const asset of candidates) {
    const label = asset.symbol ?? asset.mint.slice(0, 6);
    let pools: ApiPool[];
    try {
      pools = await raydiumPools(asset.mint);
    } catch (error) {
      skipped.push(`${label}: ${(error as Error).message}`);
      continue;
    }
    let taken = 0;
    for (const pool of pools) {
      if (taken >= PER_INTERMEDIATE) break;
      if (pool.programId !== RAYDIUM_CLMM) continue;
      const pair = new Set([pool.mintA.address, pool.mintB.address]);
      if (!(pair.has(asset.mint) && pair.has(USDC) && pair.size === 2)) continue;
      if (known.has(pool.id)) { skipped.push(`${label}: ${pool.id} already in the registry`); continue; }
      if (pool.tvl < RECORD_TVL_USD) continue;
      const enabled = pool.tvl >= MIN_TVL_USD;
      const record: VerifiedPool = {
        id: `raydium:${pool.id}`,
        representationId: intermediateRepresentationId(asset.mint),
        mint: asset.mint,
        // Provider is a representation concept; an intermediate has none. The
        // field is required, so the first provider label stands in and the
        // eligibility says what the record is.
        provider: "xstocks",
        tokenSymbol: asset.symbol ?? asset.mint.slice(0, 6),
        venue: "raydium",
        address: pool.id,
        programId: pool.programId,
        poolType: "clmm",
        baseMint: pool.mintA.address,
        quoteMint: pool.mintB.address,
        feeBps: Math.round(pool.feeRate * 10_000),
        feeConfig: pool.config ? { configId: pool.config.id, tickSpacing: pool.config.tickSpacing } : null,
        observedTokenPrograms: { base: pool.mintA.programId, quote: pool.mintB.programId },
        tvlUsd: pool.tvl,
        discoveredFrom: "RAYDIUM_API:intermediate-routes",
        discoverySources: ["RAYDIUM_API"],
        discoveredAt: now,
        verifiedAt: now,
        verification: "DISCOVERED",
        onchainVerifiedAt: null,
        verificationDetail: null,
        eligibility: "INTERMEDIATE_ROUTE",
        dbc: null,
        enabled,
        disabledReason: enabled ? null : `TVL $${Math.round(pool.tvl)} below $${MIN_TVL_USD} floor`,
      };
      const problems = validatePool(record);
      if (problems.length) { skipped.push(`${label}: ${pool.id} ${problems.join("; ")}`); continue; }
      admitted.push(record);
      known.add(pool.id);
      taken += 1;
    }
    if (!taken) skipped.push(`${label}: no new Raydium CLMM USDC pool`);
  }
  // The registry's canonical order: representation, then TVL descending.
  const merged = [...registry, ...admitted].sort((a, b) =>
    a.representationId === b.representationId ? (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) : a.representationId.localeCompare(b.representationId),
  );
  await writeFile(REGISTRY, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  process.stdout.write(`admitted ${admitted.length} INTERMEDIATE_ROUTE pools (${admitted.filter((p) => p.enabled).length} enabled)\n`);
  for (const p of admitted) process.stdout.write(`  ${p.tokenSymbol.padEnd(6)} ${p.address} tvl $${Math.round(p.tvlUsd ?? 0)} fee ${p.feeBps} bps ${p.enabled ? "" : "(disabled)"}\n`);
  for (const s of skipped) process.stdout.write(`  skip ${s}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
