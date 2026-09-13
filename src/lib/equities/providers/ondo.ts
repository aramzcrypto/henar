import { normalizeRepresentation, type CatalogEntry } from "./common";

export function adaptOndo(entry: CatalogEntry) {
  if (
    entry.provider !== "Ondo" ||
    !entry.source.startsWith("https://github.com/ondoprotocol/")
  )
    throw new Error("Invalid Ondo catalog source.");
  return normalizeRepresentation(entry, {
    provider: "ondo",
    providerLabel: "Ondo",
    issuer: "Ondo Global Markets (BVI) Limited",
    issuerUrl: "https://ondo.finance/ondo-stocks",
    redemptionModel: "Stablecoin cash value · Eligibility required",
    dividendTreatment: null,
    transferRestrictions: null,
    corporateActionMechanism: null,
    defiSupport: null,
  });
}
