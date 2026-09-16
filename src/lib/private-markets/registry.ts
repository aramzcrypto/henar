/**
 * Private markets: provider catalogs (live), company grouping, on-chain and
 * routing enrichment. Each provider is fetched independently so an outage at
 * one leaves the other's products intact and is reported as such.
 */
import { createReadCache } from "@/lib/read-cache";
import { groupByCompany } from "./companies";
import { executionReference, liquidityIntelligence, registryLiquidity } from "./liquidity";
import { onchainStates } from "./onchain";
import { imageFromMetadataUri } from "./token-art";
import { prestocksCatalog, PRESTOCKS_API } from "./providers/prestocks";
import { tesseraCatalog, TESSERA_API } from "./providers/tessera";
import type { PrivateExposureProduct, PrivateMarkets, PrivateProvider, ProviderSourceStatus } from "./types";

export type LoadOptions = { onchain?: boolean; execution?: boolean; liquidity?: boolean };

async function source(provider: PrivateProvider, url: string, load: () => Promise<{ products: PrivateExposureProduct[]; fetchedAt: string }>) {
  try {
    const value = await load();
    return { products: value.products, status: { provider, status: "available" as const, products: value.products.length, fetchedAt: value.fetchedAt, error: null, url } satisfies ProviderSourceStatus };
  } catch (error) {
    return { products: [] as PrivateExposureProduct[], status: { provider, status: "unavailable" as const, products: 0, fetchedAt: null, error: (error as Error).message, url } satisfies ProviderSourceStatus };
  }
}

/** Provider catalogs only; no chain, no quotes. Cheap and cached per provider. */
export async function privateMarketCatalog(): Promise<PrivateMarkets> {
  const [prestocks, tessera] = await Promise.all([source("prestocks", PRESTOCKS_API, prestocksCatalog), source("tessera", TESSERA_API, tesseraCatalog)]);
  const products = [...prestocks.products, ...tessera.products];
  return { companies: groupByCompany(products), products, sources: [prestocks.status, tessera.status], generatedAt: new Date().toISOString() };
}

const enriched = createReadCache<PrivateMarkets>(30_000, 4);

/** Catalogs plus on-chain state and the executable reference per product. */
export async function loadPrivateMarkets(options: LoadOptions = { onchain: true, execution: true }): Promise<PrivateMarkets> {
  const key = JSON.stringify({ onchain: Boolean(options.onchain), execution: Boolean(options.execution), liquidity: Boolean(options.liquidity) });
  return enriched(key, async () => {
    const catalog = await privateMarketCatalog();
    if (!options.onchain && !options.execution && !options.liquidity) return catalog;
    const states = options.onchain || options.execution || options.liquidity ? await onchainStates(catalog.products.map((p) => p.mint)) : {};
    const products = await Promise.all(
      catalog.products.map(async (product) => {
        const onchain = states[product.mint] ?? null;
        const [execution, liquidity, mintImage] = await Promise.all([
          options.execution ? executionReference(product.mint, onchain) : Promise.resolve(null),
          options.liquidity ? liquidityIntelligence(product.mint, onchain) : Promise.resolve(null),
          // A provider that publishes no image in its catalog may still point
          // at one from the mint itself; that is the issuer's own artwork.
          product.image ? Promise.resolve(product.image) : imageFromMetadataUri(onchain?.metadataUri),
        ]);
        /* The depth ladder costs quotes, so it is opt-in; the registry's own
           view of the product's pools is a local read and always attached. */
        return { ...product, image: mintImage ?? product.image, onchain: options.onchain ? onchain : null, execution, liquidity: liquidity ?? registryLiquidity(product.mint) };
      }),
    );
    return { ...catalog, companies: groupByCompany(products), products, generatedAt: new Date().toISOString() };
  });
}

export async function privateProductForMint(mint: string, options?: LoadOptions) {
  const markets = await loadPrivateMarkets(options);
  return markets.products.find((p) => p.mint === mint) ?? null;
}
