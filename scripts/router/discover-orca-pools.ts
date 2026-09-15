/**
 * Orca Whirlpool discovery for the verified equity universe.
 *
 * Venue-native and deterministic: read Whirlpool accounts from the program
 * itself and keep every pool holding a verified representation mint, whatever
 * it is paired against. Orca's HTTP index answers 403 to an ordinary
 * integrator, so chain state is both the authoritative and the only available
 * source — which is the right dependency anyway. Registry
 * membership must not depend on what an aggregator happened to route during a
 * build, which is how an Orca NVDAx pool reached production while the
 * committed snapshot showed no Orca coverage at all.
 *
 * Counter-assets are recorded rather than filtered. Graph routing is not being
 * built here, but a stock whose deepest public pool is paired with SOL rather
 * than USDC is a fact worth knowing before deciding whether it ever should be.
 *
 * Writes src/data/router/orca-discovery.json. `router:pools:build` decides
 * eligibility and enablement from the pair; nothing here is trusted yet.
 *
 * Output is sorted by (mint, pool address) so two runs against the same chain
 * state produce byte-identical files apart from `fetchedAt`.
 */
import { writeFile } from "node:fs/promises";
import { equityRegistry } from "../../src/lib/equities/registry";

const OUTPUT = "src/data/router/orca-discovery.json";
const WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
/** Whirlpool accounts are a fixed size, so one filtered scan finds them all. */
const WHIRLPOOL_ACCOUNT_BYTES = 653;

type OrcaPool = {
  address: string;
  tokenA: { mint: string };
  tokenB: { mint: string };
  tickSpacing: number | null;
  feeRate: number | null;
};

type DiscoveredPool = {
  address: string;
  programId: string;
  venue: "orca";
  poolType: "whirlpool";
  stockMint: string;
  counterMint: string;
  tokenSymbol: string;
  representationId: string;
  provider: string;
  baseMint: string;
  quoteMint: string;
  tickSpacing: number | null;
  feeBps: number | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  discoverySource: "ORCA_ONCHAIN";
  fetchedAt: string;
};

async function readWhirlpools(): Promise<OrcaPool[]> {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc)
    throw new Error(
      "SOLANA_RPC_URL is required: Orca's HTTP index returns 403 and an empty file would read as 'no Orca pools exist', which is not known.",
    );
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const orca = await import("@orca-so/whirlpools-sdk");
  const connection = new Connection(rpc, "confirmed");
  const program = new PublicKey(WHIRLPOOL_PROGRAM);
  const accounts = await connection.getProgramAccounts(program, {
    commitment: "confirmed",
    filters: [{ dataSize: WHIRLPOOL_ACCOUNT_BYTES }],
  });
  const pools: OrcaPool[] = [];
  for (const { pubkey, account } of accounts) {
    const decoded = orca.ParsableWhirlpool.parse(pubkey, account);
    if (!decoded) continue;
    pools.push({
      address: pubkey.toBase58(),
      tokenA: { mint: decoded.tokenMintA.toBase58() },
      tokenB: { mint: decoded.tokenMintB.toBase58() },
      tickSpacing: decoded.tickSpacing ?? null,
      feeRate: decoded.feeRate ?? null,
    });
  }
  if (!pools.length) throw new Error("no Whirlpool accounts decoded");
  return pools;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  // One filtered program scan, then a local join: a query per mint would be
  // hundreds of round trips for the same account set.
  const pools = await readWhirlpools();

  const byMint = new Map<string, { representationId: string; provider: string; tokenSymbol: string }>();
  for (const equity of equityRegistry)
    for (const rep of equity.representations)
      byMint.set(rep.mint, {
        representationId: rep.id,
        provider: rep.provider,
        tokenSymbol: rep.tokenSymbol,
      });

  const discovered: DiscoveredPool[] = [];
  for (const pool of pools) {
    const a = pool.tokenA?.mint;
    const b = pool.tokenB?.mint;
    if (!a || !b || !pool.address) continue;
    const hitA = byMint.get(a);
    const hitB = byMint.get(b);
    if (!hitA && !hitB) continue;
    // A pool pairing two registry mints is recorded once, keyed on tokenA.
    const stockMint = hitA ? a : b;
    const counterMint = hitA ? b : a;
    const rep = hitA ?? hitB!;
    discovered.push({
      address: pool.address,
      programId: WHIRLPOOL_PROGRAM,
      venue: "orca",
      poolType: "whirlpool",
      stockMint,
      counterMint,
      tokenSymbol: rep.tokenSymbol,
      representationId: rep.representationId,
      provider: rep.provider,
      baseMint: a,
      quoteMint: b,
      tickSpacing: pool.tickSpacing,
      // Whirlpool feeRate is hundredths of a bp (10000 = 1%).
      feeBps: pool.feeRate === null ? null : Math.round(pool.feeRate / 100),
      // Chain state carries no USD value; the verification pass prices pools.
      tvlUsd: null,
      volume24hUsd: null,
      discoverySource: "ORCA_ONCHAIN",
      fetchedAt,
    });
  }

  // Deterministic order, and one entry per pool address.
  const unique = [...new Map(discovered.map((p) => [p.address, p])).values()].sort(
    (x, y) => x.stockMint.localeCompare(y.stockMint) || x.address.localeCompare(y.address),
  );

  await writeFile(OUTPUT, `${JSON.stringify({ fetchedAt, pools: unique }, null, 2)}\n`, "utf8");

  const counter = new Map<string, number>();
  for (const pool of unique) counter.set(pool.counterMint, (counter.get(pool.counterMint) ?? 0) + 1);
  const reps = new Set(unique.map((p) => p.representationId));
  process.stdout.write(
    `orca discovery: ${pools.length} Whirlpools on chain, ${unique.length} touching a verified mint, ${reps.size} representations\n`,
  );
  for (const [mint, count] of [...counter].sort((a, b) => b[1] - a[1]).slice(0, 8))
    process.stdout.write(`  counter ${mint} ${count}\n`);
  process.stdout.write(`  wrote ${OUTPUT}\n`);
}

void main();
