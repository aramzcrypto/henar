/**
 * How much of each verified mint actually exists on chain.
 *
 * A registered mint is not a tokenized stock. Backpack publishes a Solana
 * address for more than a thousand securities, but a token only comes into
 * existence when someone withdraws an entitlement, and most never have been:
 * sampled against mainnet on 21 September 2026, 5.5% of its mints held any
 * supply at all. xStocks was at 100% and Ondo at 94%.
 *
 * That difference is invisible in a catalog count and invisible in AMM
 * liquidity, and it is the difference between a product and a placeholder. It
 * can only be read from the mint account, so it is read from there.
 */
import { PublicKey } from "@solana/web3.js";
import { inspectionFromAccount } from "@henar/router-core";
import { assertMainnet, connection } from "@/lib/solana";

/** Solana returns at most this many accounts per getMultipleAccounts call. */
export const SUPPLY_BATCH = 100;
const CONCURRENCY = 4;

export type MintSupply = {
  mint: string;
  /** Display units: raw / 10^decimals, times the scaled-UI multiplier. */
  supply: number | null;
  decimals: number | null;
  /** False when the account exists and holds nothing, null when unread. */
  live: boolean | null;
};

/**
 * Display supply as a number.
 *
 * The sibling `displaySupply` returns a string because a balance must not lose
 * precision. This one is for totals and counts, where a float is the right
 * shape and the exactness is not load-bearing.
 */
export function supplyToNumber(raw: bigint, decimals: number, multiplier: string | null) {
  const base = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(base)) return null;
  if (!multiplier || multiplier === "1") return base;
  const scale = Number(multiplier);
  return Number.isFinite(scale) ? base * scale : base;
}

/** Pure: a mint account becomes its supply. Unreadable accounts stay unknown. */
export function supplyFromAccount(
  mint: string,
  account: { owner: PublicKey; data: Buffer; executable: boolean; lamports: number; rentEpoch?: number } | null,
): MintSupply {
  if (!account) return { mint, supply: null, decimals: null, live: null };
  try {
    const inspection = inspectionFromAccount(mint, account, new Date().toISOString());
    /* Supply sits at offset 36 of the mint layout, u64 little-endian, in both
       token programs. Token-2022 appends its extensions after the base
       layout, so the field is in the same place either way. */
    const raw = account.data.readBigUInt64LE(36);
    const supply = supplyToNumber(raw, inspection.decimals, inspection.scaledUiMultiplier);
    return {
      mint,
      supply,
      decimals: inspection.decimals,
      live: supply === null ? null : supply > 0,
    };
  } catch {
    return { mint, supply: null, decimals: null, live: null };
  }
}

export function chunkMints(mints: string[], size = SUPPLY_BATCH) {
  return Array.from({ length: Math.ceil(mints.length / size) }, (_, index) =>
    mints.slice(index * size, (index + 1) * size),
  );
}

/**
 * Read supply for a set of mints. A batch that fails leaves its mints unknown
 * rather than zero: "we could not read it" and "nothing exists" are different
 * facts and the counts downstream report them differently.
 */
export async function readMintSupplies(mints: string[]): Promise<Map<string, MintSupply>> {
  const unique = [...new Set(mints)];
  const result = new Map<string, MintSupply>();
  if (!unique.length) return result;
  const c = connection();
  await assertMainnet(c);
  const batches = chunkMints(unique);
  let next = 0;
  /* A few at a time rather than one after another: the whole catalog is
     twenty-three calls, and sequentially that is seconds of a cold request.
     Bounded rather than unbounded because this is someone's RPC plan, and a
     burst is how a provider starts answering 429. */
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CONCURRENCY, batches.length)) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          const infos = await c.getMultipleAccountsInfo(
            batch.map((mint) => new PublicKey(mint)),
            "confirmed",
          );
          batch.forEach((mint, index) =>
            result.set(mint, supplyFromAccount(mint, infos[index] ?? null)),
          );
        } catch {
          for (const mint of batch) result.set(mint, { mint, supply: null, decimals: null, live: null });
        }
      }
    }),
  );
  return result;
}
