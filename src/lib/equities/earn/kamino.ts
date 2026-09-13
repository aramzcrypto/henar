import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import type { Equity, EarnOpportunity } from "../types";

// Official xStocks market: kamino.com/docs/build/developers/multiply/operations/withdraw-xstocks
export const KAMINO_XSTOCKS_MARKET =
  "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
export const KAMINO_METRICS_URL = `https://api.kamino.finance/kamino-market/${KAMINO_XSTOCKS_MARKET}/reserves/metrics`;
const numeric = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const schema = z.array(
  z.object({
    reserve: z.string(),
    liquidityTokenMint: z.string(),
    liquidityToken: z.string(),
    supplyApy: numeric.nullable().optional(),
    totalSupplyUsd: numeric.nullable().optional(),
    totalSupply: numeric.nullable().optional(),
    totalBorrow: numeric.nullable().optional(),
  }),
);
const cached = createReadCache<{ metrics: unknown; asOf: string }>(60_000, 1);
export function normalizeKamino(
  equity: Equity,
  raw: unknown,
  asOf: string,
): EarnOpportunity[] {
  const metrics = schema.parse(raw);
  return metrics.flatMap((reserve) => {
    const representation = equity.representations.find(
      (r) =>
        r.mint === reserve.liquidityTokenMint &&
        r.providerStatus === "verified",
    );
    if (!representation) return [];
    const utilization =
      reserve.totalSupply &&
      reserve.totalBorrow !== null &&
      reserve.totalBorrow !== undefined
        ? reserve.totalBorrow / reserve.totalSupply
        : null;
    return [
      {
        id: `kamino:${reserve.reserve}`,
        companyId: equity.id,
        representationId: representation.id,
        provider: representation.provider,
        protocol: "Kamino",
        opportunityType: "lending" as const,
        network: "solana" as const,
        currentAPY:
          reserve.supplyApy === null || reserve.supplyApy === undefined
            ? null
            : reserve.supplyApy * 100,
        tvlUsd: reserve.totalSupplyUsd ?? null,
        utilization:
          utilization !== null && utilization <= 1 ? utilization : null,
        underlyingToken: {
          mint: representation.mint,
          symbol: representation.tokenSymbol,
        },
        destinationUrl: "https://kamino.com/borrow?collateralPreset=xStocks",
        // Metrics establish an existing reserve, not account eligibility or deposit capacity.
        status: "requires_verification" as const,
        lastUpdated: asOf,
        sourceUrl: KAMINO_METRICS_URL,
      },
    ];
  });
}
export async function kaminoOpportunities(equity: Equity) {
  const snapshot = await cached("xstocks", async () => {
    const response = await fetch(KAMINO_METRICS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error("Kamino reserve data unavailable.");
    // Keep raw numeric strings for normalization; validate before caching.
    const raw = await response.json();
    schema.parse(raw);
    return { metrics: raw, asOf: new Date().toISOString() };
  });
  return normalizeKamino(equity, snapshot.metrics, snapshot.asOf);
}
