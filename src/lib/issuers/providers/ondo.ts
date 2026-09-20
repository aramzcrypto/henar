/**
 * Ondo Global Markets.
 *
 * Ondo's market-data API is real and documented, but it is not public: every
 * route under `https://api.gm.ondo.finance/v1` requires an `x-api-key`, and
 * the key is issued through onboarding rather than self-serve. Probed on
 * 20 September 2026 without one, every route answers `403 Forbidden`.
 *
 * So this adapter is written against the documented contract and reports
 * `not_configured` until `ONDO_API_KEY` exists. Nothing about Ondo's tokens
 * is estimated in the meantime: what Henar shows for Ondo comes from the
 * mints themselves and from on-chain markets, both of which are independent
 * of the issuer's API.
 *
 * Contract: https://docs.ondo.finance/api-reference/quickstart
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import { provenance } from "@/lib/provenance";
import { issuerRepresentations } from "../profiles";
import type { IssuerDisclosure, IssuerMeasure } from "../types";

export const ONDO_API = "https://api.gm.ondo.finance/v1";
export const ONDO_DOCS = "https://docs.ondo.finance/api-reference/quickstart";
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_MS = 10 * 60_000;

const metadataSchema = z.object({
  symbol: z.string(),
  name: z.string().nullish(),
  assetClass: z.string().nullish(),
  exchange: z.string().nullish(),
  status: z.string().nullish(),
});

const addressSchema = z.object({
  symbol: z.string().nullish(),
  addresses: z
    .array(z.object({ chainId: z.union([z.string(), z.number()]).nullish(), address: z.string().nullish() }))
    .nullish(),
});

const marketStatusSchema = z.object({ status: z.string().nullish(), isOpen: z.boolean().nullish() });

export type OndoMetadata = z.infer<typeof metadataSchema>;
export type OndoAddresses = z.infer<typeof addressSchema>;

export function ondoApiKey(env: Record<string, string | undefined> = process.env) {
  const key = env.ONDO_API_KEY?.trim();
  return key ? key : null;
}

function rows<T>(payload: unknown, schema: z.ZodType<T>): T[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return list.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Solana deployments the issuer publishes, matched against verified mints. */
export function summarizeOndo(
  metadata: OndoMetadata[],
  addresses: OndoAddresses[],
  marketOpen: boolean | null,
  verifiedMints: Set<string>,
): IssuerMeasure[] {
  const published = new Set<string>();
  const chains = new Set<string>();
  for (const entry of addresses)
    for (const deployment of entry.addresses ?? []) {
      if (deployment.chainId !== null && deployment.chainId !== undefined) chains.add(String(deployment.chainId));
      if (deployment.address) published.add(deployment.address);
    }
  const matched = [...published].filter((address) => verifiedMints.has(address)).length;
  const classes = new Set(metadata.flatMap((row) => (row.assetClass ? [row.assetClass] : [])));
  return [
    { id: "catalogAssets", label: "Tokens published", value: metadata.length, unit: "count" },
    { id: "solanaAssets", label: "Addresses published", value: published.size, unit: "count" },
    {
      id: "henarVerified",
      label: "Verified in Henar",
      value: matched,
      unit: "count",
      detail: "Issuer-published addresses matching a verified Henar mint",
    },
    { id: "networks", label: "Chains", value: chains.size, unit: "count", detail: [...chains].slice(0, 6).join(", ") || null },
    { id: "assetClasses", label: "Asset classes", value: classes.size, unit: "count", detail: [...classes].join(", ") || null },
    {
      id: "marketStatus",
      label: "Underlying market",
      value: marketOpen === null ? null : marketOpen ? "Open" : "Closed",
      unit: "text",
    },
  ];
}

const cache = createReadCache<IssuerDisclosure>(CACHE_MS, 2, { staleWhileRevalidate: true });

export async function ondoDisclosure(
  options: { fetch?: typeof fetch; apiKey?: string | null; fresh?: boolean } = {},
): Promise<IssuerDisclosure> {
  const key = options.apiKey === undefined ? ondoApiKey() : options.apiKey;
  const observedAt = new Date().toISOString();
  const base = {
    source: "Ondo Global Markets",
    sourceUrl: ONDO_DOCS,
    provenance: provenance({
      source: "Ondo Global Markets",
      provider: "ondo",
      sourceType: "provider-catalog",
      observedAt,
      freshness: key ? "fresh" : "unknown",
      url: ONDO_API,
    }),
  };
  if (!key)
    return {
      ...base,
      status: "not_configured" as const,
      measures: [],
      networks: [],
      reserves: null,
      reason:
        "Ondo's market-data API requires a key issued through onboarding, and ONDO_API_KEY is not set on this deployment. Ondo figures on Henar come from the mints and from onchain markets instead.",
    };
  const read = async () => {
      const fetchImpl = options.fetch ?? fetch;
      const read = async (path: string) => {
        const response = await fetchImpl(`${ONDO_API}/${path}`, {
          headers: { "x-api-key": key, accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Ondo ${path} returned ${response.status}`);
        return response.json();
      };
      try {
        const [metadata, addresses, status] = await Promise.all([
          read("assets/all/metadata"),
          read("assets/all/addresses").catch(() => []),
          read("status/market").catch(() => null),
        ]);
        const verified = new Set(issuerRepresentations("ondo").map((item) => item.mint));
        const parsedStatus = marketStatusSchema.safeParse(status);
        return {
          ...base,
          status: "available" as const,
          measures: summarizeOndo(
            rows(metadata, metadataSchema),
            rows(addresses, addressSchema),
            parsedStatus.success ? (parsedStatus.data.isOpen ?? null) : null,
            verified,
          ),
          networks: [],
          reserves: null,
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
  /* Keyed by the credential in play, not by the provider alone: the cached
     closure captures the key it was created with, so a rotated key or a
     second credential must not be served the first one's catalog. */
  if (options.fetch || options.apiKey !== undefined) return read();
  return cache("ondo", read, options.fresh);
}
