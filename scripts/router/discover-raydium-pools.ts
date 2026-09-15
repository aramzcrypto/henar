/**
 * Raydium pool discovery for the verified equity universe.
 *
 * Stage one of the pool registry: for every representation mint in Henar's
 * canonical registry, ask Raydium's v3 API which pools pair it with USDC and
 * record the raw result. Nothing here is trusted yet — stage two
 * (build-pool-registry) matches each pool's mints exactly against the
 * registry and rejects anything that does not map to a verified mint.
 *
 * Discovery is keyed by mint, never by ticker string.
 */
import { writeFile } from "node:fs/promises";
import { equityRegistry } from "../../src/lib/equities/registry";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ALL_PAIRS = process.env.RAYDIUM_ALL_PAIRS === "1";
const OUTPUT = ALL_PAIRS ? "src/data/router/raydium-discovery-all.json" : "src/data/router/raydium-discovery.json";
const CONCURRENCY = 3;
const DELAY_MS = 180;

type RaydiumPool = {
  id: string;
  programId: string;
  type: string;
  feeRate: number;
  tvl: number;
  price?: number;
  mintA: { address: string; programId?: string; decimals?: number };
  mintB: { address: string; programId?: string; decimals?: number };
  config?: { id: string; tradeFeeRate: number; tickSpacing?: number } | null;
  day?: { volume?: number } | null;
};

export type DiscoveryRow = {
  mint: string;
  representationId: string;
  provider: string;
  tokenSymbol: string;
  pools: RaydiumPool[];
  fetchedAt: string;
  error: string | null;
};

const mints = equityRegistry.flatMap((equity) =>
  equity.representations
    .filter((r) => r.providerStatus === "verified")
    .map((r) => ({
      mint: r.mint,
      representationId: r.id,
      provider: r.provider,
      tokenSymbol: r.tokenSymbol,
    })),
);

async function main() {
  const queue = [...mints];
  const rows: DiscoveryRow[] = [];
  let done = 0;
  let withPools = 0;

  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      done += 1;
      const fetchedAt = new Date().toISOString();
      try {
        /* With ALL_PAIRS set, mint2 is omitted and Raydium returns every pool
           holding this mint rather than only its USDC pair. That is how
           stock/SOL liquidity on Raydium is found at all: asking for the USDC
           pair can only ever return the USDC pair, so 310 USDC pools were
           mistaken for the whole of Raydium's coverage. */
        const params = new URLSearchParams({
          mint1: item.mint,
          ...(ALL_PAIRS ? {} : { mint2: USDC }),
          poolType: "all",
          poolSortField: "default",
          sortType: "desc",
          pageSize: "50",
          page: "1",
        });
        const res = await fetch(
          `https://api-v3.raydium.io/pools/info/mint?${params}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: { data?: RaydiumPool[] } };
        const pools = body.data?.data ?? [];
        if (pools.length) withPools += 1;
        rows.push({ ...item, pools, fetchedAt, error: null });
      } catch (error) {
        rows.push({
          ...item,
          pools: [],
          fetchedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (done % 100 === 0)
        process.stdout.write(`  ${done}/${mints.length} mints, ${withPools} with pools\n`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  process.stdout.write(`Discovering Raydium pools for ${mints.length} verified mints…\n`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  rows.sort((a, b) => a.mint.localeCompare(b.mint));
  await writeFile(OUTPUT, `${JSON.stringify(rows)}\n`, "utf8");
  const pools = rows.reduce((s, r) => s + r.pools.length, 0);
  const errors = rows.filter((r) => r.error).length;
  process.stdout.write(
    `\nWrote ${OUTPUT}: ${rows.length} mints, ${withPools} with pools, ${pools} raw pools, ${errors} errors.\n`,
  );
}

main().catch((e) => { process.stderr.write(`${e}\n`); process.exitCode = 1; });
