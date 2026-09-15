/**
 * On-chain pool verification — the only writer of ONCHAIN_VERIFIED /
 * VERIFICATION_FAILED and of `onchainVerifiedAt`.
 *
 * For each pool: read the pool account (owner must be the registry program,
 * and its own bytes must name the pair the registry records) and both mint
 * accounts (program, decimals, extensions via `inspectionFromAccount`). A pool
 * passes when every fact agrees with the registry and both mints are
 * supported.
 *
 * Confirming the pool's own pair is not optional. Without it this pass proved
 * only that the account existed under the right program and that the two mints
 * the registry claimed existed somewhere on chain, so a record pointing at a
 * real pool trading a different pair verified cleanly — and Native execution
 * trusts the record to choose what it swaps through. A pool whose layout
 * cannot be decoded stays DISCOVERED: unconfirmed is not verified.
 *
 * `classifyPoolVerification` is pure so it is unit-tested on synthetic
 * accounts; `verifyPoolsOnchain` does the RPC reads.
 */
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { canDecodePoolMints, decodePoolMints, mintsAgree } from "./pool-mints";
import { inspectionFromAccount } from "./token-extensions";
import type { MintInspection, VerifiedPool } from "./types";

export type PoolVerificationOutcome = {
  address: string;
  verification: VerifiedPool["verification"];
  detail: string;
  observedTokenPrograms: { base: string | null; quote: string | null };
  baseMint: MintInspection | null;
  quoteMint: MintInspection | null;
  slot: number | null;
};

export function classifyPoolVerification(
  pool: VerifiedPool,
  poolAccount: AccountInfo<Buffer> | null,
  baseAccount: AccountInfo<Buffer> | null,
  quoteAccount: AccountInfo<Buffer> | null,
  slot: number | null,
  readAt = new Date().toISOString(),
): PoolVerificationOutcome {
  const problems: string[] = [];
  let unconfirmedPair: string | null = null;
  if (!poolAccount) problems.push("pool account missing");
  else if (poolAccount.owner.toBase58() !== pool.programId) problems.push(`pool owned by ${poolAccount.owner.toBase58()}, registry says ${pool.programId}`);
  else if (!canDecodePoolMints(pool.poolType)) unconfirmedPair = `no decoder for ${pool.poolType}; pair not confirmed against the pool account`;
  else {
    const decoded = decodePoolMints(pool.poolType, poolAccount.data);
    if (!decoded) problems.push(`pool account is ${poolAccount.data.length} bytes, too short for the ${pool.poolType} layout`);
    else if (!mintsAgree(decoded, pool.baseMint, pool.quoteMint))
      problems.push(`pool trades ${decoded.base}/${decoded.quote}, registry says ${pool.baseMint}/${pool.quoteMint}`);
  }
  const base = baseAccount ? inspectionFromAccount(pool.baseMint, baseAccount, readAt) : null;
  const quote = quoteAccount ? inspectionFromAccount(pool.quoteMint, quoteAccount, readAt) : null;
  if (!base) problems.push("base mint account missing");
  else if (!base.supported) problems.push(`base mint unsupported: ${base.unsupportedReason}`);
  if (!quote) problems.push("quote mint account missing");
  else if (!quote.supported) problems.push(`quote mint unsupported: ${quote.unsupportedReason}`);
  if (base && pool.observedTokenPrograms?.base && base.program !== pool.observedTokenPrograms.base)
    problems.push(`base program ${base.program} differs from venue metadata ${pool.observedTokenPrograms.base}`);
  if (quote && pool.observedTokenPrograms?.quote && quote.program !== pool.observedTokenPrograms.quote)
    problems.push(`quote program ${quote.program} differs from venue metadata ${pool.observedTokenPrograms.quote}`);
  const verification = problems.length
    ? "VERIFICATION_FAILED"
    : unconfirmedPair
      ? "DISCOVERED"
      : "ONCHAIN_VERIFIED";
  return {
    address: pool.address,
    verification,
    detail: problems.length
      ? problems.join("; ")
      : (unconfirmedPair ?? `pool pair, owner and both mints verified at slot ${slot ?? "?"}`),
    observedTokenPrograms: { base: base?.program ?? null, quote: quote?.program ?? null },
    baseMint: base,
    quoteMint: quote,
    slot,
  };
}

/** Apply an outcome to a registry record (returns a new record; never mutates). */
export function applyVerification(pool: VerifiedPool, outcome: PoolVerificationOutcome, at: string): VerifiedPool {
  const ok = outcome.verification === "ONCHAIN_VERIFIED";
  const failed = outcome.verification === "VERIFICATION_FAILED";
  return {
    ...pool,
    verification: outcome.verification,
    onchainVerifiedAt: ok ? at : null,
    verificationDetail: outcome.detail,
    observedTokenPrograms: outcome.observedTokenPrograms,
    // A contradicted pool is disabled. A merely unconfirmed one keeps the
    // enablement it already had: the guard refuses anything not
    // ONCHAIN_VERIFIED anyway, and inventing a disabledReason here would
    // overwrite the real one recorded at build time.
    enabled: failed ? false : pool.enabled,
    disabledReason: failed ? `VERIFICATION_FAILED: ${outcome.detail}` : pool.disabledReason,
  };
}

export async function verifyPoolsOnchain(connection: Connection, pools: VerifiedPool[], options: { batch?: number; now?: () => number } = {}) {
  const at = new Date(options.now?.() ?? Date.now()).toISOString();
  const batch = options.batch ?? 30;
  const outcomes: PoolVerificationOutcome[] = [];
  for (let i = 0; i < pools.length; i += batch) {
    const slice = pools.slice(i, i + batch);
    const keys = slice.flatMap((p) => [p.address, p.baseMint, p.quoteMint]).map((k) => new PublicKey(k));
    const [slot, infos] = await Promise.all([connection.getSlot("confirmed"), connection.getMultipleAccountsInfo(keys, "confirmed")]);
    slice.forEach((pool, j) => outcomes.push(classifyPoolVerification(pool, infos[j * 3] ?? null, infos[j * 3 + 1] ?? null, infos[j * 3 + 2] ?? null, slot, at)));
  }
  const byAddress = new Map(outcomes.map((o) => [o.address, o]));
  const updated = pools.map((p) => applyVerification(p, byAddress.get(p.address)!, at));
  return { at, outcomes, updated };
}
