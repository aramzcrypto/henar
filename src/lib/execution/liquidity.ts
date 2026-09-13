import { z } from "zod";
import type { PoolLiquiditySnapshot } from "./types";

const raydiumSchema = z.object({
  success: z.literal(true),
  data: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        mintA: z.object({ address: z.string() }),
        mintB: z.object({ address: z.string() }),
        price: z.number().finite().optional(),
        feeRate: z.number().finite().optional(),
        tvl: z.number().nonnegative().optional(),
        day: z
          .object({ volume: z.number().nonnegative().optional() })
          .optional(),
      }),
    ),
  }),
});

const meteoraSchema = z.object({
  data: z.array(
    z.object({
      address: z.string(),
      token_x: z.object({ address: z.string() }),
      token_y: z.object({ address: z.string() }),
      current_price: z.number().finite().optional(),
      tvl: z.number().nonnegative().optional(),
      dynamic_fee_pct: z.number().nonnegative().optional(),
      volume: z
        .object({ "24h": z.number().nonnegative().optional() })
        .optional(),
      is_blacklisted: z.boolean().optional(),
    }),
  ),
});

const orcaSchema = z.object({
  data: z.array(z.record(z.unknown())),
});

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value))
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nested(record: Record<string, unknown>, ...keys: string[]) {
  let current: unknown = record;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export async function raydiumLiquidity(
  inputMint: string,
  outputMint: string,
): Promise<PoolLiquiditySnapshot[]> {
  const params = new URLSearchParams({
    mint1: inputMint,
    mint2: outputMint,
    poolType: "all",
    poolSortField: "liquidity",
    sortType: "desc",
    pageSize: "20",
    page: "1",
  });
  const response = await fetch(
    `https://api-v3.raydium.io/pools/info/mint?${params}`,
    { next: { revalidate: 30 }, signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error("Raydium pool data unavailable.");
  const data = raydiumSchema.parse(await response.json()).data.data;
  const asOf = new Date().toISOString();
  return data.map((pool) => ({
    source: "raydium",
    pool: pool.id,
    inputMint,
    outputMint,
    liquidityUsd: pool.tvl ?? null,
    volume24hUsd: pool.day?.volume ?? null,
    feePct: pool.feeRate === undefined ? null : pool.feeRate * 100,
    price: pool.price ?? null,
    asOf,
  }));
}

export async function meteoraLiquidity(
  inputMint: string,
  outputMint: string,
): Promise<PoolLiquiditySnapshot[]> {
  const pair = [inputMint, outputMint].sort().join("-");
  const response = await fetch(
    `https://dlmm.datapi.meteora.ag/pools/groups/${pair}?page_size=100`,
    { next: { revalidate: 30 }, signal: AbortSignal.timeout(8_000) },
  );
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Meteora pool data unavailable.");
  const data = meteoraSchema
    .parse(await response.json())
    .data.filter((pool) => !pool.is_blacklisted);
  const asOf = new Date().toISOString();
  return data.map((pool) => ({
    source: "meteora",
    pool: pool.address,
    inputMint,
    outputMint,
    liquidityUsd: pool.tvl ?? null,
    volume24hUsd: pool.volume?.["24h"] ?? null,
    feePct: pool.dynamic_fee_pct ?? null,
    price: pool.current_price ?? null,
    asOf,
  }));
}

export async function orcaLiquidity(
  inputMint: string,
  outputMint: string,
): Promise<PoolLiquiditySnapshot[]> {
  const params = new URLSearchParams({
    tokensBothOf: `${inputMint},${outputMint}`,
    size: "100",
    stats: "24h",
    includeBlocked: "false",
  });
  const response = await fetch(
    `https://api.orca.so/v2/solana/pools?${params}`,
    {
      headers: { Accept: "application/json", "User-Agent": "Henar/1.0" },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error("Orca pool data unavailable.");
  const rows = orcaSchema.parse(await response.json()).data;
  const asOf = new Date().toISOString();
  return rows.flatMap((pool) => {
    const address = String(pool.address ?? "");
    const mintA = String(
      nested(pool, "tokenA", "address") ?? nested(pool, "tokenMintA") ?? "",
    );
    const mintB = String(
      nested(pool, "tokenB", "address") ?? nested(pool, "tokenMintB") ?? "",
    );
    if (
      !address ||
      !(
        (mintA === inputMint && mintB === outputMint) ||
        (mintB === inputMint && mintA === outputMint)
      )
    )
      return [];
    const rawFeeRate = number(pool.feeRate);
    return [
      {
        source: "orca" as const,
        pool: address,
        inputMint,
        outputMint,
        liquidityUsd: number(pool.tvlUsdc ?? pool.tvlUsd ?? pool.tvl),
        volume24hUsd: number(
          nested(pool, "stats", "24h", "volume") ?? pool.volume24hUsd,
        ),
        feePct:
          number(pool.feeRatePercent) ??
          (rawFeeRate === null ? null : rawFeeRate / 10_000),
        price: number(pool.price),
        asOf,
      },
    ];
  });
}

export async function aggregatePoolLiquidity(
  inputMint: string,
  outputMint: string,
) {
  const sources = [
    ["raydium", raydiumLiquidity],
    ["orca", orcaLiquidity],
    ["meteora", meteoraLiquidity],
  ] as const;
  const settled = await Promise.allSettled(
    sources.map(([, load]) => load(inputMint, outputMint)),
  );
  return {
    pools: settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
    sources: settled.map((result, index) => ({
      source: sources[index][0],
      status:
        result.status === "fulfilled"
          ? ("available" as const)
          : ("unavailable" as const),
      reason: result.status === "rejected" ? "Pool index unavailable." : null,
    })),
    asOf: new Date().toISOString(),
  };
}
