/**
 * Stage two of the pool registry: turn raw venue discovery dumps into
 * `src/data/router/pools.json`, the only pool list the router may read.
 *
 * Admission rules (each one is a hard reject, never a warning):
 *  - the pool's two mints must be exactly {registry mint, USDC}. Any pool
 *    pairing with SOL, another stable, or a look-alike mint is dropped;
 *  - the registry mint must belong to a `verified` representation;
 *  - the program id must be one we recognise for that venue.
 *
 * Pools that pass are recorded, then enabled only when:
 *  - the pool type has a direct adapter (Raydium CLMM today);
 *  - reported TVL is at least MIN_TVL_USD.
 * Everything else is kept with `enabled: false` and a reason, so the file
 * documents what was seen and why it is not routed.
 *
 * Every pool leaves here as `verification: "DISCOVERED"` with
 * `onchainVerifiedAt: null`. Discovery metadata says which token program a
 * mint uses; only an RPC read can confirm it, and this script runs without
 * RPC. A separate verification pass is the only writer of ONCHAIN_VERIFIED /
 * VERIFICATION_FAILED and of the timestamp.
 */
import { readFile, writeFile } from "node:fs/promises";
import { equityRegistry } from "../../src/lib/equities/registry";
import type { DiscoveryRow } from "./discover-raydium-pools";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUTPUT = "src/data/router/pools.json";
const NON_ROUTABLE_OUTPUT = "src/data/router/non-routable-pairs.json";
const MIN_TVL_USD = 1_000;

const RAYDIUM_PROGRAMS: Record<string, { poolType: string; direct: boolean }> = {
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { poolType: "clmm", direct: true },
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: { poolType: "cpmm", direct: false },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { poolType: "amm_v4", direct: false },
};

const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const METEORA_DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const METEORA_DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

type OrcaDiscoveryFile = {
  fetchedAt: string;
  pools: {
    address: string;
    programId: string;
    stockMint: string;
    counterMint: string;
    representationId: string;
    provider: string;
    tokenSymbol: string;
    baseMint: string;
    quoteMint: string;
    tickSpacing: number | null;
    feeBps: number | null;
    tvlUsd: number | null;
    discoverySource: string;
    fetchedAt: string;
  }[];
};

type MeteoraDiscoveryRow = {
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
  error: string | null;
};

type Pool = {
  id: string;
  representationId: string;
  mint: string;
  provider: string;
  tokenSymbol: string;
  venue: string;
  address: string;
  programId: string;
  poolType: string;
  baseMint: string;
  quoteMint: string;
  feeBps: number | null;
  feeConfig: { configId?: string; tickSpacing?: number; binStep?: number } | null;
  observedTokenPrograms: { base: string | null; quote: string | null } | null;
  tvlUsd: number | null;
  discoveredFrom: string;
  /** Closed set; only a venue-native source may enable a pool. */
  discoverySources?: (
    | "RAYDIUM_API"
    | "RAYDIUM_ONCHAIN"
    | "ORCA_API"
    | "ORCA_ONCHAIN"
    | "METEORA_API"
    | "METEORA_ONCHAIN"
    | "JUPITER_FORENSICS"
  )[];
  discoveredAt: string;
  verifiedAt: string;
  verification: "DISCOVERED" | "ONCHAIN_VERIFIED" | "VERIFICATION_FAILED";
  onchainVerifiedAt: string | null;
  verificationDetail: string | null;
  eligibility: "ROUTER_ELIGIBLE" | "STOCK_PAIRED_INFRASTRUCTURE";
  dbc: {
    configAddress: string;
    lifecycle: "BONDING" | "MIGRATING" | "GRADUATED" | "PAUSED" | "UNKNOWN";
    lifecycleCheckedAt: string | null;
    lifecycleSlot: number | null;
    successorStatus: "NOT_APPLICABLE" | "CONFIRMED" | "UNRESOLVED";
    successorPoolAddress: string | null;
    successorConfirmedAt: string | null;
  } | null;
  enabled: boolean;
  disabledReason: string | null;
};

/**
 * Meteora DBC / DAMM v2 discovery rows, written by
 * `scripts/router/discover-meteora-dbc.ts` (RPC-gated). A row is kept when
 * at least one side is a verified registry mint; eligibility is decided
 * here from the pair, never from the discovery file.
 */
type MeteoraDbcDiscoveryRow = {
  poolAddress: string;
  configAddress: string;
  baseMint: string;
  quoteMint: string;
  lifecycle: "BONDING" | "MIGRATING" | "GRADUATED" | "PAUSED" | "UNKNOWN";
  lifecycleSlot: number | null;
  successorStatus: "NOT_APPLICABLE" | "CONFIRMED" | "UNRESOLVED";
  successorPoolAddress: string | null;
  baseFeeBps: number | null;
  fetchedAt: string;
};

type MeteoraDammV2DiscoveryRow = {
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  feeBps: number | null;
  /** DBC pool this DAMM v2 pool graduated from, when known. */
  predecessorDbcPool: string | null;
  fetchedAt: string;
};

const verifiedMints = new Map<
  string,
  { representationId: string; provider: string; tokenSymbol: string }
>();
for (const equity of equityRegistry)
  for (const r of equity.representations)
    if (r.providerStatus === "verified")
      verifiedMints.set(r.mint, {
        representationId: r.id,
        provider: r.provider,
        tokenSymbol: r.tokenSymbol,
      });

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function exactPair(a: string, b: string, mint: string) {
  return (a === mint && b === USDC) || (a === USDC && b === mint);
}

function main() {
  return (async () => {
    const now = new Date().toISOString();
    const pools: Pool[] = [];
    /* Public pools holding a verified stock mint against something other than
       USDC. Route search is direct-pair only, so these are not routable today;
       they are the evidence for whether that should change. */
    const nonRoutable: {
      address: string;
      venue: string;
      programId: string;
      stockMint: string;
      counterMint: string;
      representationId: string;
      provider: string;
      tokenSymbol: string;
      tvlUsd: number | null;
      status: "DISCOVERED_NON_ROUTABLE_PAIR";
      discoverySources: string[];
      discoveredAt: string;
    }[] = [];
    const rejected: Record<string, number> = {};
    const reject = (why: string) => {
      rejected[why] = (rejected[why] ?? 0) + 1;
    };

    const raydium = await readJson<DiscoveryRow[]>(
      "src/data/router/raydium-discovery.json",
    );
    for (const row of raydium ?? []) {
      const rep = verifiedMints.get(row.mint);
      if (!rep) {
        reject("raydium: mint not verified in registry");
        continue;
      }
      for (const p of row.pools) {
        const a = p.mintA.address;
        const b = p.mintB.address;
        if (!exactPair(a, b, row.mint)) {
          reject("raydium: not an exact mint/USDC pair");
          continue;
        }
        const program = RAYDIUM_PROGRAMS[p.programId];
        if (!program) {
          reject(`raydium: unknown program ${p.programId}`);
          continue;
        }
        const tvl = Number.isFinite(p.tvl) ? p.tvl : null;
        const feeBps =
          p.config?.tradeFeeRate !== undefined
            ? Math.round(p.config.tradeFeeRate / 100) // 1e6 denominator → bps
            : Number.isFinite(p.feeRate)
              ? Math.round(p.feeRate * 10_000)
              : null;
        let disabledReason: string | null = null;
        if (!program.direct)
          disabledReason = `No direct adapter for Raydium ${program.poolType}; reachable via Jupiter only`;
        else if (tvl === null || tvl < MIN_TVL_USD)
          disabledReason = `TVL ${tvl === null ? "unknown" : `$${Math.round(tvl)}`} below $${MIN_TVL_USD} floor`;
        pools.push({
          id: `raydium:${p.id}`,
          representationId: rep.representationId,
          mint: row.mint,
          provider: rep.provider,
          tokenSymbol: rep.tokenSymbol,
          venue: "raydium",
          address: p.id,
          programId: p.programId,
          poolType: program.poolType,
          baseMint: a,
          quoteMint: b,
          feeBps,
          feeConfig: p.config
            ? { configId: p.config.id, tickSpacing: p.config.tickSpacing }
            : null,
          observedTokenPrograms: {
            base: p.mintA.programId ?? null,
            quote: p.mintB.programId ?? null,
          },
          tvlUsd: tvl,
          discoveredFrom: "api-v3.raydium.io/pools/info/mint",
          discoverySources: ["RAYDIUM_API"],
          discoveredAt: row.fetchedAt,
          verifiedAt: now,
          // Venue metadata only. Chain verification is a separate, RPC-gated
          // pass that alone may set ONCHAIN_VERIFIED and its timestamp.
          verification: "DISCOVERED",
          onchainVerifiedAt: null,
          verificationDetail: null,
          eligibility: "ROUTER_ELIGIBLE",
          dbc: null,
          enabled: disabledReason === null,
          disabledReason,
        });
      }
    }

    /* Orca, from ORCA_ONCHAIN discovery. Only {representation, USDC} enters
       the executable registry; every other counter asset is recorded so the
       liquidity is known without being routed, since route search is still
       direct-pair only. Chain state carries no USD value, so TVL is unknown
       here and the RPC-gated verification pass is the only thing that can
       price a pool — a freshly discovered Orca pool therefore arrives
       disabled by design rather than by accident. */
    const orca = await readJson<OrcaDiscoveryFile>(
      "src/data/router/orca-discovery.json",
    );
    for (const pool of orca?.pools ?? []) {
      const rep = verifiedMints.get(pool.stockMint);
      if (!rep) {
        reject("orca: mint not verified in registry");
        continue;
      }
      if (pool.programId !== ORCA_WHIRLPOOL_PROGRAM) {
        reject(`orca: unknown program ${pool.programId}`);
        continue;
      }
      const tvl = Number.isFinite(pool.tvlUsd) ? pool.tvlUsd : null;
      if (pool.counterMint !== USDC) {
        /* Recorded, not routed. pools.json is the executable registry and
           `validatePool` requires a USDC pair, which is a safety contract
           rather than a formatting rule; loosening it to carry intelligence
           would weaken the thing that keeps an unroutable pool out of a
           quote. These go to their own artifact instead. */
        nonRoutable.push({
          address: pool.address,
          venue: "orca",
          programId: pool.programId,
          stockMint: pool.stockMint,
          counterMint: pool.counterMint,
          representationId: rep.representationId,
          provider: rep.provider,
          tokenSymbol: rep.tokenSymbol,
          tvlUsd: tvl,
          status: "DISCOVERED_NON_ROUTABLE_PAIR",
          discoverySources: ["ORCA_ONCHAIN"],
          discoveredAt: pool.fetchedAt,
        });
        continue;
      }
      let disabledReason: string | null = null;
      if (tvl === null || tvl < MIN_TVL_USD)
        disabledReason = `TVL ${tvl === null ? "unknown" : `$${Math.round(tvl)}`} below $${MIN_TVL_USD} floor`;
      pools.push({
        id: `orca:${pool.address}`,
        representationId: rep.representationId,
        mint: pool.stockMint,
        provider: rep.provider,
        tokenSymbol: rep.tokenSymbol,
        venue: "orca",
        address: pool.address,
        programId: pool.programId,
        poolType: "whirlpool",
        baseMint: pool.baseMint,
        quoteMint: pool.quoteMint,
        feeBps: pool.feeBps,
        feeConfig: pool.tickSpacing === null ? null : { tickSpacing: pool.tickSpacing },
        observedTokenPrograms: null,
        tvlUsd: tvl,
        discoveredFrom: "orca:getProgramAccounts(whirlpool)",
        discoverySources: ["ORCA_ONCHAIN"],
        discoveredAt: pool.fetchedAt,
        verifiedAt: now,
        verification: "DISCOVERED",
        onchainVerifiedAt: null,
        verificationDetail: null,
        eligibility: "ROUTER_ELIGIBLE",
        dbc: null,
        enabled: disabledReason === null,
        disabledReason,
      });
    }

    const meteora = await readJson<MeteoraDiscoveryRow[]>(
      "src/data/router/meteora-discovery.json",
    );
    for (const row of meteora ?? []) {
      const rep = verifiedMints.get(row.mint);
      if (!rep) {
        reject("meteora: mint not verified in registry");
        continue;
      }
      for (const pair of row.pairs) {
        if (!exactPair(pair.tokenXMint, pair.tokenYMint, row.mint)) {
          reject("meteora: not an exact mint/USDC pair");
          continue;
        }
        pools.push({
          id: `meteora:${pair.address}`,
          representationId: rep.representationId,
          mint: row.mint,
          provider: rep.provider,
          tokenSymbol: rep.tokenSymbol,
          venue: "meteora",
          address: pair.address,
          programId: METEORA_DLMM_PROGRAM,
          poolType: "dlmm",
          baseMint: pair.tokenXMint,
          quoteMint: pair.tokenYMint,
          feeBps: pair.baseFeeBps,
          feeConfig: { binStep: pair.binStep },
          observedTokenPrograms: null,
          tvlUsd: null,
          discoveredFrom: "rpc:DLMM.getLbPairs",
          discoveredAt: row.fetchedAt,
          verifiedAt: now,
          verification: "DISCOVERED",
          onchainVerifiedAt: null,
          verificationDetail: null,
          eligibility: "ROUTER_ELIGIBLE",
          dbc: null,
          // DLMM discovery reports no TVL; a pair is enabled only after a
          // reviewer records liquidity. Until then the adapter reports
          // NO_VERIFIED_POOL, which is the honest state.
          enabled: false,
          disabledReason: "DLMM liquidity not yet reviewed",
        });
      }
    }

    // Meteora DBC and its DAMM v2 successors. A pair that is exactly
    // {registry mint, USDC} is ROUTER_ELIGIBLE; a pair where a registry mint
    // is one side but the other side is not USDC (a launch token priced in
    // NVDAx, say) is STOCK_PAIRED_INFRASTRUCTURE: indexed and monitored,
    // never routed by the equity engine.
    const classify = (a: string, b: string) => {
      const repA = verifiedMints.get(a);
      const repB = verifiedMints.get(b);
      if (exactPair(a, b, a) && repA) return { mint: a, rep: repA, eligibility: "ROUTER_ELIGIBLE" as const };
      if (exactPair(a, b, b) && repB) return { mint: b, rep: repB, eligibility: "ROUTER_ELIGIBLE" as const };
      // Quote-side stock is the DBC pattern (NEW_TOKEN priced in NVDAx).
      if (repB) return { mint: b, rep: repB, eligibility: "STOCK_PAIRED_INFRASTRUCTURE" as const };
      if (repA) return { mint: a, rep: repA, eligibility: "STOCK_PAIRED_INFRASTRUCTURE" as const };
      return null;
    };

    const dbc = await readJson<MeteoraDbcDiscoveryRow[]>("src/data/router/meteora-dbc-discovery.json");
    for (const row of dbc ?? []) {
      const c = classify(row.baseMint, row.quoteMint);
      if (!c) {
        reject("dbc: neither mint is a verified registry mint");
        continue;
      }
      const routable = c.eligibility === "ROUTER_ELIGIBLE" && row.lifecycle === "BONDING";
      pools.push({
        id: `meteora-dbc:${row.poolAddress}`,
        representationId: c.rep.representationId,
        mint: c.mint,
        provider: c.rep.provider,
        tokenSymbol: c.rep.tokenSymbol,
        venue: "meteora-dbc",
        address: row.poolAddress,
        programId: METEORA_DBC_PROGRAM,
        poolType: "dbc",
        baseMint: row.baseMint,
        quoteMint: row.quoteMint,
        feeBps: row.baseFeeBps,
        feeConfig: { configId: row.configAddress },
        observedTokenPrograms: null,
        tvlUsd: null,
        discoveredFrom: "rpc:DynamicBondingCurveClient.state",
        discoveredAt: row.fetchedAt,
        verifiedAt: now,
        verification: "DISCOVERED",
        onchainVerifiedAt: null,
        verificationDetail: null,
        eligibility: c.eligibility,
        dbc: {
          configAddress: row.configAddress,
          lifecycle: row.lifecycle,
          lifecycleCheckedAt: row.fetchedAt,
          lifecycleSlot: row.lifecycleSlot,
          successorStatus: row.successorStatus,
          successorPoolAddress: row.successorPoolAddress,
          successorConfirmedAt: row.successorStatus === "CONFIRMED" ? row.fetchedAt : null,
        },
        enabled: routable,
        disabledReason: routable
          ? null
          : c.eligibility !== "ROUTER_ELIGIBLE"
            ? "STOCK_PAIRED_INFRASTRUCTURE: not a USDC↔equity route"
            : `DBC lifecycle ${row.lifecycle}`,
      });
    }

    const damm = await readJson<MeteoraDammV2DiscoveryRow[]>("src/data/router/meteora-damm-v2-discovery.json");
    for (const row of damm ?? []) {
      const c = classify(row.tokenAMint, row.tokenBMint);
      if (!c) {
        reject("damm-v2: neither mint is a verified registry mint");
        continue;
      }
      const routable = c.eligibility === "ROUTER_ELIGIBLE";
      pools.push({
        id: `meteora-damm-v2:${row.poolAddress}`,
        representationId: c.rep.representationId,
        mint: c.mint,
        provider: c.rep.provider,
        tokenSymbol: c.rep.tokenSymbol,
        venue: "meteora-damm-v2",
        address: row.poolAddress,
        programId: METEORA_DAMM_V2_PROGRAM,
        poolType: "damm_v2",
        baseMint: row.tokenAMint,
        quoteMint: row.tokenBMint,
        feeBps: row.feeBps,
        feeConfig: null,
        observedTokenPrograms: null,
        tvlUsd: null,
        discoveredFrom: row.predecessorDbcPool
          ? `rpc:dbc-successor:${row.predecessorDbcPool}`
          : "rpc:CpAmm.fetchPoolStatesByTokenMint",
        discoveredAt: row.fetchedAt,
        verifiedAt: now,
        verification: "DISCOVERED",
        onchainVerifiedAt: null,
        verificationDetail: null,
        eligibility: c.eligibility,
        dbc: null,
        enabled: routable,
        disabledReason: routable ? null : "STOCK_PAIRED_INFRASTRUCTURE: not a USDC↔equity route",
      });
    }

    pools.sort((a, b) =>
      a.representationId === b.representationId
        ? (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)
        : a.representationId.localeCompare(b.representationId),
    );
    await writeFile(OUTPUT, `${JSON.stringify(pools, null, 2)}\n`, "utf8");
    nonRoutable.sort(
      (a, b) => a.stockMint.localeCompare(b.stockMint) || a.address.localeCompare(b.address),
    );
    await writeFile(
      NON_ROUTABLE_OUTPUT,
      `${JSON.stringify({ generatedAt: now, pools: nonRoutable }, null, 2)}\n`,
      "utf8",
    );

    const enabled = pools.filter((p) => p.enabled);
    const reps = new Set(enabled.map((p) => p.representationId));
    process.stdout.write(
      `Wrote ${OUTPUT}: ${pools.length} verified pools, ${enabled.length} enabled across ${reps.size} representations.\n`,
    );
    process.stdout.write(
      `  ${nonRoutable.length} non-routable pairs recorded in ${NON_ROUTABLE_OUTPUT}\n`,
    );
    for (const [why, count] of Object.entries(rejected))
      process.stdout.write(`  rejected ${count}: ${why}\n`);
    if (!raydium) process.stdout.write("  (no raydium-discovery.json found)\n");
    if (!meteora) process.stdout.write("  (no meteora-discovery.json found)\n");
    if (!dbc) process.stdout.write("  (no meteora-dbc-discovery.json found)\n");
    if (!damm) process.stdout.write("  (no meteora-damm-v2-discovery.json found)\n");
  })();
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
