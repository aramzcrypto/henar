import { PACK_PRICE, validateBps, type Category } from "./product-config";

// Reference accounting only. Apply confirmed vault events in an authoritative
// program/indexer; never accept client-submitted yield or balances as evidence.
export type EarnPreferences = {
  destination: "packs" | "stocks";
  stockMint?: string;
  autoPacks: boolean;
  category: Category;
};
export type SealedBatch = {
  firstId: bigint;
  count: bigint;
  category: Category;
  source: "Earned";
  valuePerPack: bigint;
};
export type EarnLedger = {
  principal: bigint;
  grossYield: bigint;
  protocolYield: bigint;
  feeRemainder: bigint;
  claimableYield: bigint;
  claimedYield: bigint;
  allocatedYield: bigint;
  packsCreated: bigint;
};
export function emptyLedger(): EarnLedger {
  return {
    principal: 0n,
    grossYield: 0n,
    protocolYield: 0n,
    feeRemainder: 0n,
    claimableYield: 0n,
    claimedYield: 0n,
    allocatedYield: 0n,
    packsCreated: 0n,
  };
}
function positive(value: bigint) {
  if (value <= 0n) throw new Error("Amount must be positive.");
}
export function depositPrincipal(
  ledger: EarnLedger,
  amount: bigint,
): EarnLedger {
  positive(amount);
  return { ...ledger, principal: ledger.principal + amount };
}
export function withdrawPrincipal(
  ledger: EarnLedger,
  amount: bigint,
): EarnLedger {
  positive(amount);
  if (amount > ledger.principal) throw new Error("Insufficient principal.");
  return { ...ledger, principal: ledger.principal - amount };
}
export function claimYield(ledger: EarnLedger, amount: bigint): EarnLedger {
  positive(amount);
  if (amount > ledger.claimableYield)
    throw new Error("Insufficient claimable yield.");
  return {
    ...ledger,
    claimableYield: ledger.claimableYield - amount,
    claimedYield: ledger.claimedYield + amount,
  };
}
export function allocatePacks(
  ledger: EarnLedger,
  preferences: EarnPreferences,
): { ledger: EarnLedger; batch: SealedBatch | null } {
  if (preferences.destination !== "packs" || !preferences.autoPacks)
    return { ledger, batch: null };
  const count = ledger.claimableYield / PACK_PRICE;
  if (!count) return { ledger, batch: null };
  const allocated = count * PACK_PRICE;
  return {
    ledger: {
      ...ledger,
      claimableYield: ledger.claimableYield - allocated,
      allocatedYield: ledger.allocatedYield + allocated,
      packsCreated: ledger.packsCreated + count,
    },
    batch: {
      firstId: ledger.packsCreated,
      count,
      category: preferences.category,
      source: "Earned",
      valuePerPack: PACK_PRICE,
    },
  };
}
// Cumulative confirmed gross yield makes retries idempotent. Integer fee carry
// ensures many tiny accruals charge exactly the same share as one large accrual.
export function settleYield(
  ledger: EarnLedger,
  cumulativeGross: bigint,
  shareBps: number,
  preferences: EarnPreferences,
) {
  validateBps(shareBps);
  if (cumulativeGross < ledger.grossYield)
    throw new Error(
      "Gross yield cannot decrease. Vault losses require separate reconciliation.",
    );
  const delta = cumulativeGross - ledger.grossYield;
  const numerator = delta * BigInt(shareBps) + ledger.feeRemainder;
  const fee = numerator / 10000n;
  return allocatePacks(
    {
      ...ledger,
      grossYield: cumulativeGross,
      protocolYield: ledger.protocolYield + fee,
      feeRemainder: numerator % 10000n,
      claimableYield: ledger.claimableYield + delta - fee,
    },
    preferences,
  );
}
export function packQuote(source: "Purchased" | "Earned", feeBps: number) {
  validateBps(feeBps);
  const fee = source === "Earned" ? 0n : (PACK_PRICE * BigInt(feeBps)) / 10000n;
  return { price: PACK_PRICE, fee, stockValue: PACK_PRICE - fee };
}
export function yieldProgress(claimable: bigint) {
  if (claimable < 0n) throw new Error("Negative yield.");
  return {
    readyPacks: claimable / PACK_PRICE,
    remainder: claimable % PACK_PRICE,
    basisPoints: ((claimable % PACK_PRICE) * 10000n) / PACK_PRICE,
  };
}
