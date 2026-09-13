export const PRODUCTS = {
  earn: 1,
  limit: 2,
  dca: 4,
  stocks: 8,
  packs: 16,
  lucky: 32,
} as const;
export const PUBLIC_PILOT = "11111111111111111111111111111111";
export function productMask(
  kind: "earn" | "limit" | "dca",
  destination: "packs" | "stocks",
) {
  return (
    PRODUCTS[kind] |
    (kind === "earn" && destination === "stocks" ? PRODUCTS.stocks : 0)
  );
}
export function assertAdmission(
  config: {
    paused: boolean;
    enabledProducts: number;
    pilotOwner: { toString(): string };
    admissionLimit: { toString(): string };
    admittedUsdc: { toString(): string };
  },
  owner: string,
  mask: number,
  amount = 0n,
) {
  if (config.paused || (config.enabledProducts & mask) !== mask)
    throw new Error("This product is not activated yet.");
  const pilot = config.pilotOwner.toString();
  if (pilot !== PUBLIC_PILOT && pilot !== owner)
    throw new Error(
      "Mainnet testing is currently limited to the pilot wallet.",
    );
  if (
    amount < 0n ||
    BigInt(config.admittedUsdc.toString()) + amount >
      BigInt(config.admissionLimit.toString())
  )
    throw new Error("The mainnet testing deposit limit has been reached.");
}
export function productAvailable(
  view:
    | {
        paused: boolean;
        access?: { enabledProducts: number; walletAllowed?: boolean };
      }
    | null
    | undefined,
  mask: number,
) {
  return (
    !!view?.access &&
    !view.paused &&
    view.access.walletAllowed !== false &&
    (view.access.enabledProducts & mask) === mask
  );
}
