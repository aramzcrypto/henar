/**
 * xStocks, read from Backed's own public API.
 *
 * This is the one issuer of the three that publishes proof of reserves, and
 * it is the most consequential thing on this page: for every token it lists,
 * the API states how many underlying shares are held and by which custodian,
 * against the circulating token supply. Henar reports that comparison as the
 * issuer states it and does not restate it as a guarantee.
 *
 * Every endpoint here is public and unauthenticated. Nothing is inferred from
 * a ticker: the Solana deployment address the issuer publishes is matched
 * against Henar's verified mint, and only the matches count.
 *
 * Source, read 20 September 2026: https://docs.xstocks.fi/developers
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { provenance } from "@/lib/provenance";
import { issuerRepresentations } from "../profiles";
import type { IssuerDisclosure, IssuerMeasure, IssuerReserves } from "../types";

export const XSTOCKS_API = "https://api.xstocks.fi/api/v2/public";
export const XSTOCKS_DOCS = "https://docs.xstocks.fi/developers";
const PAGE_SIZE = 100;
/** Bounded so a paging bug cannot walk forever. The catalog is ~10 pages. */
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_MS = 10 * 60_000;

const pageSchema = z.object({ hasNextPage: z.boolean().optional() }).optional();

const assetSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  underlyingSymbol: z.string().nullish(),
  isTradingHalted: z.boolean().optional(),
  trading: z
    .object({
      tradingHoursMode: z.string().nullish(),
      exchange: z.object({ abbreviation: z.string().nullish() }).nullish(),
    })
    .nullish(),
  deployments: z
    .array(z.object({ address: z.string().nullish(), network: z.string().nullish() }))
    .optional(),
});

const reserveSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().optional(),
  sharesHeld: z.string(),
  circulatingSupply: z.string(),
  holdings: z.array(z.object({ provider: z.string(), quantity: z.string().optional() })).optional(),
});

const oracleSchema = z.object({
  symbol: z.string().nullish(),
  network: z.string().nullish(),
  managedBy: z.string().nullish(),
});

export type XStocksAsset = z.infer<typeof assetSchema>;
export type XStocksReserve = z.infer<typeof reserveSchema>;
export type XStocksOracle = z.infer<typeof oracleSchema>;

function nodesOf<T>(payload: unknown, schema: z.ZodType<T>): T[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { nodes?: unknown }).nodes)
      ? (payload as { nodes: unknown[] }).nodes
      : [];
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

function hasNextPage(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  return pageSchema.safeParse((payload as { page?: unknown }).page).data?.hasNextPage === true;
}

async function readAll<T>(path: string, schema: z.ZodType<T>, fetchImpl: typeof fetch): Promise<T[]> {
  const collected: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchImpl(`${XSTOCKS_API}/${path}?page=${page}&pageSize=${PAGE_SIZE}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`xStocks ${path} returned ${response.status}`);
    const payload = await response.json();
    collected.push(...nodesOf(payload, schema));
    if (!hasNextPage(payload)) break;
  }
  return collected;
}

/** A ratio is only meaningful where a token is actually outstanding. */
export function backingRatio(reserve: XStocksReserve): number | null {
  const held = Number(reserve.sharesHeld);
  const supply = Number(reserve.circulatingSupply);
  if (!Number.isFinite(held) || !Number.isFinite(supply) || supply <= 0) return null;
  return held / supply;
}

export function summarizeReserves(reserves: XStocksReserve[]): IssuerReserves {
  const ratios: number[] = [];
  let fullyBacked = 0;
  const custodians = new Map<string, number>();
  let observedAt: string | null = null;
  for (const reserve of reserves) {
    for (const holding of reserve.holdings ?? [])
      custodians.set(holding.provider, (custodians.get(holding.provider) ?? 0) + 1);
    if (reserve.timestamp && (!observedAt || reserve.timestamp > observedAt)) observedAt = reserve.timestamp;
    const ratio = backingRatio(reserve);
    if (ratio === null) continue;
    ratios.push(ratio);
    if (ratio >= 1) fullyBacked += 1;
  }
  ratios.sort((a, b) => a - b);
  return {
    status: reserves.length ? "available" : "unavailable",
    assets: reserves.length,
    fullyBacked,
    comparable: ratios.length,
    minRatio: ratios.length ? ratios[0] : null,
    medianRatio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : null,
    custodians: [...custodians.entries()]
      .map(([name, assets]) => ({ name, assets }))
      .sort((a, b) => b.assets - a.assets),
    observedAt,
    reason: reserves.length ? null : "The issuer returned no reserve records.",
    sourceUrl: `${XSTOCKS_API}/proof-of-reserves`,
  };
}

/** Measured facts from the issuer's catalog, plus how much of it Henar verifies. */
export function summarizeAssets(
  assets: XStocksAsset[],
  oracles: XStocksOracle[],
  verifiedMints: Set<string>,
): { measures: IssuerMeasure[]; networks: string[] } {
  const networks = new Map<string, number>();
  const hours = new Map<string, number>();
  const exchanges = new Set<string>();
  const solanaAddresses = new Set<string>();
  let halted = 0;
  for (const asset of assets) {
    if (asset.isTradingHalted) halted += 1;
    const mode = asset.trading?.tradingHoursMode;
    if (mode) hours.set(mode, (hours.get(mode) ?? 0) + 1);
    const exchange = asset.trading?.exchange?.abbreviation;
    if (exchange) exchanges.add(exchange);
    for (const deployment of asset.deployments ?? []) {
      if (!deployment.network) continue;
      networks.set(deployment.network, (networks.get(deployment.network) ?? 0) + 1);
      if (deployment.network === "Solana" && deployment.address) solanaAddresses.add(deployment.address);
    }
  }
  const matched = [...solanaAddresses].filter((address) => verifiedMints.has(address)).length;
  const roundTheClock = hours.get("TwentyFourFive") ?? 0;
  const solanaOracles = oracles.filter((oracle) => oracle.network === "Solana").length;
  return {
    networks: [...networks.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    measures: [
      { id: "catalogAssets", label: "Tokens published", value: assets.length, unit: "count", detail: "Assets in the issuer's own catalog" },
      { id: "solanaAssets", label: "Deployed on Solana", value: solanaAddresses.size, unit: "count" },
      {
        id: "henarVerified",
        label: "Verified in Henar",
        value: matched,
        unit: "count",
        detail: "Issuer-published Solana addresses matching a verified Henar mint",
      },
      /* No truncated chain list here: the full list is printed under the
         block, and two partial copies of the same fact read as a discrepancy. */
      { id: "networks", label: "Chains", value: networks.size, unit: "count", detail: null },
      {
        id: "tradingHours",
        label: "Trading 24/5",
        value: roundTheClock,
        unit: "count",
        detail: `${assets.length - roundTheClock} follow their listing venue's hours`,
      },
      { id: "listingVenues", label: "Listing venues", value: exchanges.size, unit: "count", detail: [...exchanges].slice(0, 6).join(", ") },
      { id: "halted", label: "Trading halted", value: halted, unit: "count", detail: "Reported halted by the issuer right now" },
      {
        id: "oracles",
        label: "Published price feeds",
        value: oracles.length,
        unit: "count",
        detail: solanaOracles ? `${solanaOracles} on Solana, managed by Pyth` : null,
      },
    ],
  };
}

const cache = createReadCache<IssuerDisclosure>(CACHE_MS, 2, { staleWhileRevalidate: true });

/**
 * A caller that supplies its own key or its own fetch — a test, or a probe
 * against a second credential — is asking about a different source, so it
 * bypasses the shared cache rather than reading or poisoning it.
 */
export async function xstocksDisclosure(
  options: { fetch?: typeof fetch; fresh?: boolean } = {},
): Promise<IssuerDisclosure> {
  const read = async () => {
      const fetchImpl = options.fetch ?? fetch;
      const observedAt = new Date().toISOString();
      const base = {
        source: "xStocks",
        sourceUrl: XSTOCKS_DOCS,
        provenance: provenance({
          source: "xStocks",
          provider: "xstocks",
          sourceType: "provider-catalog",
          observedAt,
          freshness: "fresh",
          url: XSTOCKS_API,
        }),
      };
      try {
        const verified = new Set(issuerRepresentations("xstocks").map((item) => item.mint));
        const [assets, reserves, oracles] = await Promise.all([
          readAll("assets", assetSchema, fetchImpl),
          readAll("proof-of-reserves", reserveSchema, fetchImpl).catch(() => [] as XStocksReserve[]),
          fetchImpl(`${XSTOCKS_API}/oracles`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
          })
            .then(async (response) => (response.ok ? nodesOf(await response.json(), oracleSchema) : []))
            .catch(() => [] as XStocksOracle[]),
        ]);
        if (!assets.length) throw new Error("The issuer's catalog came back empty.");
        const { measures, networks } = summarizeAssets(assets, oracles, verified);
        return {
          ...base,
          status: "available" as const,
          measures,
          networks,
          reserves: summarizeReserves(reserves),
          reason: null,
        };
      } catch (error) {
        return {
          ...base,
          status: "unavailable" as const,
          measures: [],
          networks: [],
          reserves: null,
          reason: (error as Error).message,
        };
      }
  };
  if (options.fetch) return read();
  return cache("xstocks", read, options.fresh);
}
