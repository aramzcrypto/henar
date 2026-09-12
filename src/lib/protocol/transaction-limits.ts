import type { VersionedMessage } from "@solana/web3.js";
const short = (n: number) => (n < 128 ? 1 : n < 16384 ? 2 : 3);
/** Measure before web3's fixed-size serializer throws an opaque buffer error. */
export function transactionLimits(m: VersionedMessage) {
  if (m.version !== 0) throw new Error("Only v0 transactions are supported");
  const bytes =
    short(m.header.numRequiredSignatures) +
    64 * m.header.numRequiredSignatures +
    4 +
    short(m.staticAccountKeys.length) +
    32 * m.staticAccountKeys.length +
    32 +
    short(m.compiledInstructions.length) +
    m.compiledInstructions.reduce(
      (n, i) =>
        n +
        1 +
        short(i.accountKeyIndexes.length) +
        i.accountKeyIndexes.length +
        short(i.data.length) +
        i.data.length,
      0,
    ) +
    short(m.addressTableLookups.length) +
    m.addressTableLookups.reduce(
      (n, t) =>
        n +
        32 +
        short(t.writableIndexes.length) +
        t.writableIndexes.length +
        short(t.readonlyIndexes.length) +
        t.readonlyIndexes.length,
      0,
    );
  const accounts =
    m.staticAccountKeys.length +
    m.addressTableLookups.reduce(
      (n, t) => n + t.writableIndexes.length + t.readonlyIndexes.length,
      0,
    );
  // Keep the conservative documented mainnet limit, regardless of future feature activation.
  return { bytes, accounts, fits: bytes <= 1232 && accounts <= 64 };
}
export function assertTransactionLimits(message: VersionedMessage) {
  const result = transactionLimits(message);
  if (!result.fits)
    throw new Error(
      `Transaction exceeds mainnet limits (${result.bytes}/1232 bytes, ${result.accounts}/64 accounts). A smaller route or configured lookup table is required.`,
    );
  return result;
}
