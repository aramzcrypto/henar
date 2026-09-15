/**
 * On-chain pool verification — the only writer of ONCHAIN_VERIFIED /
 * VERIFICATION_FAILED and of `onchainVerifiedAt`.
 *
 * For each pool: read the pool account (owner must be the registry program)
 * and both mint accounts (program, decimals, extensions via
 * `inspectionFromAccount`). A pool passes when every fact agrees with the
 * registry and both mints are supported. `classifyPoolVerification` is pure
 * so it is unit-tested on synthetic accounts; `verifyPoolsOnchain` does the
 * RPC reads.
 */
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
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
  if (!poolAccount) problems.push("pool account missing");
  else if (poolAccount.owner.toBase58() !== pool.programId) problems.push(`pool owned by ${poolAccount.owner.toBase58()}, registry says ${pool.programId}`);
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
  return {
    address: pool.address,
    verification: problems.length ? "VERIFICATION_FAILED" : "ONCHAIN_VERIFIED",
    detail: problems.length ? problems.join("; ") : `pool owner and both mints verified at slot ${slot ?? "?"}`,
    observedTokenPrograms: { base: base?.program ?? null, quote: quote?.program ?? null },
    baseMint: base,
    quoteMint: quote,
    slot,
  };
}

/** Apply an outcome to a registry record (returns a new record; never mutates). */
export function applyVerification(pool: VerifiedPool, outcome: PoolVerificationOutcome, at: string): VerifiedPool {
  const ok = outcome.verification === "ONCHAIN_VERIFIED";
  return {
    ...pool,
    verification: outcome.verification,
    onchainVerifiedAt: ok ? at : null,
    verificationDetail: outcome.detail,
    observedTokenPrograms: outcome.observedTokenPrograms,
    enabled: ok ? pool.enabled : false,
    disabledReason: ok ? pool.disabledReason : `VERIFICATION_FAILED: ${outcome.detail}`,
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
