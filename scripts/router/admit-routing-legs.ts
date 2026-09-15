/**
 * Admit verified representation/intermediate pools as routing legs.
 *
 * Discovery found 524 non-USDC Orca pools, 132 of them pairing a
 * representation with SOL or USDT across 49 representations, and they were set
 * aside because the registry only admitted USDC pairs. They are real
 * liquidity: a stock/SOL pool is exactly the edge a USDC → SOL → NVDAx route
 * needs.
 *
 * None of them carried a TVL, because the earlier pass priced only the USDC
 * side of a pool. Both sides are valued here at their own verified price, and
 * a pool whose depth cannot be established stays out: the guard refuses a pool
 * with unknown TVL, so admitting one would only move the refusal later.
 *
 * These pools are admitted as ROUTING_LEG, never ROUTER_ELIGIBLE. The guard
 * refuses a routing leg for a direct quote, and the engine only offers a pool
 * for the pair it actually trades, so admitting them cannot change any
 * existing USDC route.
 *
 *   npm run router:admit:legs
 */
import { readFile, writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  USDC_MINT,
  intermediateRecord,
  verifiedMint as verifiedMintFacts,
  isQualifiedIntermediate,
  qualifiedIntermediates,
  listRouterRepresentations,
  valueTwoSidedPool,
  verifiedMint,
  type VerifiedPool,
} from "@henar/router-core";
import { jupiterMetadata } from "@/lib/equities/jupiter";
import { quoteJupiter } from "@/lib/execution/adapters/jupiter";
import { rateLimitedConnection } from "@/lib/rpc-limiter";

const ORCA_DISCOVERY = "src/data/router/orca-discovery.json";
const RAYDIUM_DISCOVERY = "src/data/router/raydium-discovery-all.json";
/* Raydium's own TVL is used for its pools, as it is for the USDC routes
   already in the registry; Orca pools are valued from their vaults because no
   venue number exists for them. */
const RAYDIUM_PROGRAMS: Record<string, string> = {
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "clmm",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: "cpmm",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "amm_v4",
};
const REGISTRY = "src/data/router/pools.json";
const MIN_TVL_USD = Number(process.env.LEG_MIN_TVL_USD ?? "1000");
const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
/** SPL token account layout: amount is a u64 at offset 64. */
const AMOUNT_OFFSET = 64;

type RaydiumDiscoveryRow = {
  mint: string;
  tokenSymbol: string;
  representationId: string;
  provider: string;
  fetchedAt: string;
  pools: RaydiumPoolInfo[];
};

type RaydiumPoolInfo = {
  id: string;
  programId: string;
  tvl?: number;
  feeRate?: number;
  mintA?: { address: string };
  mintB?: { address: string };
};

type DiscoveredPool = {
  address: string;
  programId: string;
  venue: string;
  poolType: string;
  stockMint: string;
  counterMint: string;
  representationId: string;
  provider: string;
  tokenSymbol: string;
  baseMint: string;
  quoteMint: string;
  tickSpacing: number | null;
  feeBps: number | null;
  vaultA: string;
  vaultB: string;
  discoverySource: string;
  fetchedAt: string;
};

/** What one unit of a routing asset is worth, priced through Jupiter. */
async function routingAssetPrice(mint: string, decimals: number): Promise<number | null> {
  if (mint === USDC_MINT) return 1;
  try {
    const quote = await quoteJupiter({
      inputMint: mint,
      outputMint: USDC_MINT,
      amount: BigInt(10) ** BigInt(decimals),
      slippageBps: 50,
    });
    const usdc = Number(quote.outputAmount) / 1e6;
    return Number.isFinite(usdc) && usdc > 0 ? usdc : null;
  } catch {
    return null;
  }
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required; routing legs are admitted from chain state, not from a file.");
  const connection: Connection = rateLimitedConnection(rpc);

  const discovery = JSON.parse(await readFile(ORCA_DISCOVERY, "utf8")) as { pools: DiscoveredPool[] };
  /* Any pool whose counter asset qualified as an intermediate, not a hand
     picked pair. Qualification is the round-trip measurement, so the breadth
     here is exactly the breadth the measurement supports. */
  const candidates = discovery.pools.filter(
    (pool) => isQualifiedIntermediate(pool.counterMint) && pool.counterMint !== USDC_MINT && pool.programId === ORCA_WHIRLPOOL_PROGRAM,
  );
  process.stdout.write(`${candidates.length} pools pair a representation with one of ${qualifiedIntermediates().length} qualified intermediates\n`);

  // Prices: the stock side from the reference snapshot, the routing asset from
  // a live quote. Both are named in the valuation detail.
  const reps = listRouterRepresentations();
  const byMint = new Map(reps.map((rep) => [rep.mint, rep]));
  const wanted = reps.filter((rep) => candidates.some((pool) => pool.stockMint === rep.mint));
  const reference = await jupiterMetadata(wanted as never);
  const assetPrice = new Map<string, number | null>();
  const needed = [...new Set(candidates.map((pool) => pool.counterMint))];
  for (const mint of needed) {
    const facts = verifiedMint(mint);
    const price = facts ? await routingAssetPrice(mint, facts.decimals) : null;
    assetPrice.set(mint, price);
    const label = intermediateRecord(mint)?.symbol ?? mint.slice(0, 10);
    process.stdout.write(`  ${label} = ${price === null ? "no price" : `$${price.toFixed(4)}`}\n`);
  }

  // Vault balances, batched.
  const vaults = [...new Set(candidates.flatMap((pool) => [pool.vaultA, pool.vaultB]))];
  const balances = new Map<string, bigint>();
  for (let i = 0; i < vaults.length; i += 100) {
    const slice = vaults.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(slice.map((v) => new PublicKey(v)), "confirmed");
    slice.forEach((address, j) => {
      const info = infos[j];
      if (info && info.data.length >= AMOUNT_OFFSET + 8) balances.set(address, info.data.readBigUInt64LE(AMOUNT_OFFSET));
    });
  }
  process.stdout.write(`  read ${balances.size} of ${vaults.length} vault balances\n`);

  const registry = JSON.parse(await readFile(REGISTRY, "utf8")) as VerifiedPool[];
  const known = new Set(registry.map((pool) => pool.address));
  const admitted: VerifiedPool[] = [];
  const skipped: { address: string; symbol: string; reason: string }[] = [];
  const at = new Date().toISOString();

  for (const pool of candidates) {
    if (known.has(pool.address)) continue;
    const rep = byMint.get(pool.stockMint);
    const stockFacts = verifiedMint(pool.stockMint);
    const assetFacts = verifiedMint(pool.counterMint);
    const stockPrice = reference.get(pool.stockMint)?.referencePrice ?? null;
    const aIsStock = pool.baseMint === pool.stockMint;
    const rawA = balances.get(pool.vaultA);
    const rawB = balances.get(pool.vaultB);
    const label = intermediateRecord(pool.counterMint)?.symbol ?? pool.counterMint.slice(0, 10);
    if (!rep || !stockFacts || !assetFacts || rawA === undefined || rawB === undefined) {
      skipped.push({ address: pool.address, symbol: pool.tokenSymbol, reason: "mint facts or vault balance unavailable" });
      continue;
    }
    const stockSide = {
      rawAmount: aIsStock ? rawA : rawB,
      decimals: stockFacts.decimals,
      scaledUiMultiplier: Number(stockFacts.scaledUiMultiplier ?? "1") || 1,
      priceUsd: stockPrice,
      label: pool.tokenSymbol,
    };
    const assetSide = {
      rawAmount: aIsStock ? rawB : rawA,
      decimals: assetFacts.decimals,
      scaledUiMultiplier: Number(assetFacts.scaledUiMultiplier ?? "1") || 1,
      priceUsd: assetPrice.get(pool.counterMint) ?? null,
      label,
    };
    const valuation = valueTwoSidedPool({ a: stockSide, b: assetSide });
    if (valuation.tvlUsd === null) {
      skipped.push({ address: pool.address, symbol: pool.tokenSymbol, reason: valuation.detail });
      continue;
    }
    const deep = valuation.tvlUsd >= MIN_TVL_USD;
    admitted.push({
      id: `${pool.venue}:${pool.address}`,
      representationId: pool.representationId,
      mint: pool.stockMint,
      provider: rep.provider,
      tokenSymbol: pool.tokenSymbol,
      venue: "orca",
      address: pool.address,
      programId: pool.programId,
      poolType: "whirlpool",
      baseMint: pool.baseMint,
      quoteMint: pool.quoteMint,
      feeBps: pool.feeBps,
      feeConfig: pool.tickSpacing === null ? null : { tickSpacing: pool.tickSpacing },
      observedTokenPrograms: null,
      tvlUsd: valuation.tvlUsd,
      discoveredFrom: pool.discoverySource,
      discoverySources: ["ORCA_ONCHAIN"],
      discoveredAt: pool.fetchedAt,
      verifiedAt: at,
      verification: "DISCOVERED",
      onchainVerifiedAt: null,
      verificationDetail: `routing leg valued ${valuation.method}: ${valuation.detail}`,
      eligibility: "ROUTING_LEG",
      dbc: null,
      enabled: deep,
      disabledReason: deep ? null : `routing leg below the $${MIN_TVL_USD} floor (TVL $${Math.round(valuation.tvlUsd)})`,
    });
  }

  /* The registry's canonical order is representation, then TVL descending.
     Sorting these in by any other key makes two builds disagree on order
     while agreeing on contents, which the determinism test exists to catch. */
  /* Raydium legs. The venue reports amounts and TVL directly, so these need
     no vault read; what they do need is the same admission rules: a qualified
     intermediate on the other side, a verified representation, and depth. */
  try {
    /* The Raydium dump is a top-level array; the Orca one is an object with a
       pools key. Accepting both here beats discovering the difference through
       an empty result. */
    const parsed = JSON.parse(await readFile(RAYDIUM_DISCOVERY, "utf8")) as
      | RaydiumDiscoveryRow[]
      | { pools: RaydiumDiscoveryRow[] };
    const rows: RaydiumDiscoveryRow[] = Array.isArray(parsed) ? parsed : (parsed.pools ?? []);
    process.stdout.write(`  raydium rows: ${rows.length}\n`);
    for (const row of rows) {
      const rep = byMint.get(row.mint);
      if (!rep) continue;
      for (const pool of row.pools ?? []) {
        const poolType = RAYDIUM_PROGRAMS[pool.programId];
        const a = pool.mintA?.address;
        const b = pool.mintB?.address;
        if (!poolType || !a || !b) continue;
        const counter = a === row.mint ? b : a;
        if (counter === USDC_MINT || !isQualifiedIntermediate(counter) || known.has(pool.id)) continue;
        if (!verifiedMintFacts(counter) || !verifiedMintFacts(row.mint)) continue;
        const tvl = typeof pool.tvl === "number" && Number.isFinite(pool.tvl) ? pool.tvl : null;
        if (tvl === null) {
          skipped.push({ address: pool.id, symbol: row.tokenSymbol, reason: "venue reported no TVL" });
          continue;
        }
        /* Only pool types an adapter can quote are enabled. A cpmm or amm_v4
           leg is recorded because it is real liquidity, but nothing in the
           router can price it, so enabling it would put a pool in the
           candidate set that can only ever fail. */
        const quotable = poolType === "clmm";
        const deep = tvl >= MIN_TVL_USD && quotable;
        known.add(pool.id);
        admitted.push({
          id: `raydium:${pool.id}`,
          representationId: row.representationId,
          mint: row.mint,
          provider: rep.provider,
          tokenSymbol: row.tokenSymbol,
          venue: "raydium",
          address: pool.id,
          programId: pool.programId,
          poolType: poolType as never,
          baseMint: a,
          quoteMint: b,
          feeBps: typeof pool.feeRate === "number" ? Math.round(pool.feeRate * 10_000) : null,
          feeConfig: null,
          observedTokenPrograms: null,
          tvlUsd: tvl,
          discoveredFrom: "RAYDIUM_API",
          discoverySources: ["RAYDIUM_API"],
          discoveredAt: row.fetchedAt,
          verifiedAt: at,
          verification: "DISCOVERED",
          onchainVerifiedAt: null,
          verificationDetail: `routing leg, venue-reported TVL $${Math.round(tvl)}`,
          eligibility: "ROUTING_LEG",
          dbc: null,
          enabled: deep,
          disabledReason: deep
            ? null
            : quotable
              ? `routing leg below the $${MIN_TVL_USD} floor (TVL $${Math.round(tvl)})`
              : `no direct adapter for ${poolType}`,
        });
      }
    }
  } catch (error) {
    process.stdout.write(`  Raydium legs skipped: ${(error as Error).message}\n`);
  }

  const merged = [...registry, ...admitted].sort((a, b) =>
    a.representationId === b.representationId
      ? (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)
      : a.representationId.localeCompare(b.representationId),
  );
  await writeFile(REGISTRY, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  const enabled = admitted.filter((pool) => pool.enabled);
  process.stdout.write(`\nadmitted ${admitted.length} routing legs (${enabled.length} enabled, ${admitted.length - enabled.length} below the floor)\n`);
  const bySymbol = enabled
    .slice()
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
    .slice(0, 12);
  for (const pool of bySymbol)
    process.stdout.write(`  ${pool.tokenSymbol.padEnd(9)} ${(intermediateRecord(pool.baseMint === pool.mint ? pool.quoteMint : pool.baseMint)?.symbol ?? "?").padEnd(8)} $${Math.round(pool.tvlUsd ?? 0).toLocaleString().padStart(12)}  ${pool.address}\n`);
  if (skipped.length) {
    process.stdout.write(`  skipped ${skipped.length}:\n`);
    for (const row of skipped.slice(0, 8)) process.stdout.write(`    ${row.symbol}: ${row.reason}\n`);
  }
  process.stdout.write(`\nRun npm run router:verify:pools -- --all next; a routing leg stays DISCOVERED until then and the guard refuses it.\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
