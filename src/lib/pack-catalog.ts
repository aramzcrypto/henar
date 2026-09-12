import manifest from "../../config/mainnet-manifest.json";
import { stocks } from "./registry";
import type { Category } from "./product-config";
// Reviewed issuer-published catalog candidates. Actual pack manifests must be
// frozen onchain before purchase and preflighted for route/eligibility support.
export function packCandidates(category: Category) {
  return stocks.filter(
    (stock) =>
      stock.instrument === "Stock" &&
      (category === "Random" || stock.category === category),
  );
}

// V1 pack offering: one Random pack, restricted to Backpack stock mints.
export const BACKPACK_PACK_ID = "backpack-random-v1";
export function backpackPackCandidates() {
  const enabled = new Set(
    manifest.stocks
      .filter((stock) => stock.packEligible)
      .map((stock) => stock.mint),
  );
  return stocks.filter(
    (stock) =>
      stock.provider === "Backpack" &&
      stock.instrument === "Stock" &&
      enabled.has(stock.mint),
  );
}
