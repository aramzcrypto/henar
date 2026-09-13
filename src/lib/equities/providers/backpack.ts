import { normalizeRepresentation, type CatalogEntry } from "./common";

export function adaptBackpack(entry: CatalogEntry) {
  if (
    entry.provider !== "Backpack" ||
    entry.source !== "https://api.backpack.exchange/api/v1/assets"
  )
    throw new Error("Invalid Backpack catalog source.");
  return normalizeRepresentation(entry, {
    provider: "backpack",
    providerLabel: "Backpack Securities",
    issuer: "Backpack Securities",
    issuerUrl:
      "https://learn.backpack.exchange/blog/introducing-backpack-securities",
    redemptionModel: "1:1 security entitlement · Account required",
    dividendTreatment:
      "Reinvested into additional tokenized shares where applicable",
    transferRestrictions: null,
    corporateActionMechanism:
      "Proportional token balance adjustments where applicable",
    defiSupport: ["Self-custody", "Wallet transfer", "Solana DeFi"],
  });
}
