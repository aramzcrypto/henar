/**
 * DBC → DAMM v2 successor detection.
 *
 * The DBC program migrates into a DAMM v2 pool at a deterministic PDA:
 *   deriveDammV2PoolAddress(dammConfig, baseMint, quoteMint)
 * where `dammConfig` is the DAMM v2 config the migrator passed. For the six
 * fixed `migration_fee_option`s Meteora publishes that config
 * (`DAMM_V2_MIGRATION_FEE_ADDRESS[option]`), so the successor is derivable.
 * For `Customizable` (6) the config is whatever the migrator supplied and is
 * not recorded on the DBC pool, so derivation alone cannot resolve it.
 *
 * A successor is CONFIRMED only when the derived (or hinted) account exists,
 * is owned by the DAMM v2 program, and its token mints are exactly the DBC
 * pair. Otherwise it is UNRESOLVED with the reason. Nothing is inferred from
 * reserves or timing.
 *
 * `confirmDammV2Pool` is pure so it can be tested on synthetic accounts.
 */
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import type { DbcSuccessorStatus } from "@henar/router-core";
import { METEORA_DAMM_V2_PROGRAM, dbcSdk, type DbcMarketState } from "./state";

export type SuccessorResolution = {
  status: DbcSuccessorStatus;
  poolAddress: string | null;
  detail: string | null;
};

/** DAMM v2 `Pool` account: token_a_mint at byte 8+? — the SDK exports the offsets. */
export type DammV2MintOffsets = { tokenA: number; tokenB: number };

export async function dammV2MintOffsets(): Promise<DammV2MintOffsets> {
  const cp = await import("@meteora-ag/cp-amm-sdk");
  return { tokenA: cp.POOL_TOKEN_A_MINT_OFFSET, tokenB: cp.POOL_TOKEN_B_MINT_OFFSET };
}

/**
 * Pure check: is this account a DAMM v2 pool holding exactly {base, quote}?
 * Mint order in DAMM v2 is canonical (sorted keys), so both orders are
 * accepted.
 */
export function confirmDammV2Pool(
  account: AccountInfo<Buffer> | null,
  baseMint: string,
  quoteMint: string,
  offsets: DammV2MintOffsets,
): { ok: boolean; detail: string } {
  if (!account) return { ok: false, detail: "account does not exist" };
  if (account.owner.toBase58() !== METEORA_DAMM_V2_PROGRAM)
    return { ok: false, detail: `owner ${account.owner.toBase58()} is not the DAMM v2 program` };
  if (account.data.length < offsets.tokenB + 32)
    return { ok: false, detail: "account too small for a DAMM v2 pool" };
  const a = new PublicKey(account.data.subarray(offsets.tokenA, offsets.tokenA + 32)).toBase58();
  const b = new PublicKey(account.data.subarray(offsets.tokenB, offsets.tokenB + 32)).toBase58();
  const pair = new Set([a, b]);
  if (!(pair.has(baseMint) && pair.has(quoteMint) && pair.size === 2))
    return { ok: false, detail: `pool mints ${a}/${b} are not the DBC pair` };
  return { ok: true, detail: "DAMM v2 pool holds the DBC pair" };
}

/** Candidate successor addresses derivable from DBC config alone. */
export async function deriveDammV2SuccessorCandidates(market: DbcMarketState) {
  const m = await dbcSdk();
  const baseMint = market.pool.poolState.baseMint;
  const quoteMint = market.config.quoteMint;
  const option = Number(market.config.migrationFeeOption);
  const configs: { config: PublicKey; source: string }[] = [];
  if (option >= 0 && option < m.DAMM_V2_MIGRATION_FEE_ADDRESS.length)
    configs.push({ config: m.DAMM_V2_MIGRATION_FEE_ADDRESS[option], source: `migration_fee_option ${option}` });
  return configs.map(({ config, source }) => ({
    poolAddress: m.deriveDammV2PoolAddress(config, baseMint, quoteMint).toBase58(),
    dammConfig: config.toBase58(),
    source,
  }));
}

/**
 * Resolve the successor from chain. `hint` is an operator-supplied DAMM v2
 * pool address (for Customizable configs); it is verified like any
 * candidate, never trusted.
 */
export async function resolveDammV2Successor(
  connection: Connection,
  market: DbcMarketState,
  hint: string | null = null,
): Promise<SuccessorResolution> {
  const baseMint = market.pool.poolState.baseMint.toBase58();
  const quoteMint = market.config.quoteMint.toBase58();
  const offsets = await dammV2MintOffsets();
  const candidates = await deriveDammV2SuccessorCandidates(market);
  const addresses = [
    ...candidates.map((c) => c.poolAddress),
    ...(hint && !candidates.some((c) => c.poolAddress === hint) ? [hint] : []),
  ];
  if (!addresses.length)
    return {
      status: "UNRESOLVED",
      poolAddress: null,
      detail: `migration_fee_option ${Number(market.config.migrationFeeOption)} has no published DAMM v2 config; supply the successor pool address for verification`,
    };
  const infos = await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed");
  const reasons: string[] = [];
  for (let i = 0; i < addresses.length; i += 1) {
    const check = confirmDammV2Pool(infos[i] ?? null, baseMint, quoteMint, offsets);
    if (check.ok) return { status: "CONFIRMED", poolAddress: addresses[i], detail: check.detail };
    reasons.push(`${addresses[i]}: ${check.detail}`);
  }
  return { status: "UNRESOLVED", poolAddress: null, detail: reasons.join("; ") };
}
