import { normalizeRepresentation, type CatalogEntry } from "./common";

export function adaptXStocks(entry: CatalogEntry) {
  if (
    entry.provider !== "xStocks" ||
    !entry.source.startsWith("https://xstocks.com/")
  )
    throw new Error("Invalid xStocks catalog source.");
  return normalizeRepresentation(entry, {
    provider: "xstocks",
    providerLabel: "xStocks",
    issuer: "Backed Assets (JE) Limited",
    issuerUrl: "https://xstocks.com/",
    redemptionModel: "Cash value or underlying · Eligibility required",
    dividendTreatment: null,
    transferRestrictions: null,
    corporateActionMechanism: null,
    defiSupport: null,
  });
}
