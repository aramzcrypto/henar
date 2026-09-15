/**
 * DBC lifecycle classification.
 *
 * Decided from program state only — never from "reserve looks close to the
 * threshold". The rules, in order:
 *
 *   is_migrated == 1 or migration_progress == 3 (CreatedPool) → GRADUATED
 *   migration_progress in {1 PostBondingCurve, 2 LockedVesting} → MIGRATING
 *   quote_reserve >= migration_quote_threshold                  → MIGRATING
 *       (curve complete; the SDK itself refuses to quote: "Virtual pool is
 *        completed"; a keeper will migrate it)
 *   current_point < activation_point                             → PAUSED
 *   migration_progress == 0 and reserve below threshold          → BONDING
 *   anything else                                                → UNKNOWN
 *
 * Field meanings per Meteora's account docs: migration_progress "0
 * pre-bonding curve, 1 post-bonding curve, 2 locked vesting, 3 created
 * pool"; is_migrated "0 not migrated, 1 migrated".
 */
import type { Connection } from "@solana/web3.js";
import type { DbcLifecycleState, DbcSuccessorStatus } from "@henar/router-core";
import { dbcFacts, readDbcMarket, type DbcFacts, type DbcMarketReader, type DbcMarketState } from "./state";
import { resolveDammV2Successor, type SuccessorResolution } from "./successor";

export type LifecycleDecision = {
  state: DbcLifecycleState;
  detail: string;
  /** True only in BONDING with the activation point reached. */
  tradable: boolean;
};

export function classifyDbcLifecycle(
  facts: Pick<
    DbcFacts,
    "isMigrated" | "migrationProgress" | "quoteReserve" | "migrationQuoteThreshold" | "activationPoint"
  >,
  currentPoint: bigint,
): LifecycleDecision {
  // Only the documented values map to a state; anything else is UNKNOWN.
  if (facts.isMigrated === 1 || facts.migrationProgress === 3)
    return {
      state: "GRADUATED",
      detail: `is_migrated=${facts.isMigrated} migration_progress=${facts.migrationProgress}`,
      tradable: false,
    };
  if (facts.migrationProgress === 1 || facts.migrationProgress === 2)
    return {
      state: "MIGRATING",
      detail: `migration_progress=${facts.migrationProgress} (${facts.migrationProgress === 1 ? "post-bonding curve" : "locked vesting"})`,
      tradable: false,
    };
  if (facts.migrationQuoteThreshold > 0n && facts.quoteReserve >= facts.migrationQuoteThreshold)
    return {
      state: "MIGRATING",
      detail: "curve complete: quote_reserve >= migration_quote_threshold; awaiting migration keeper",
      tradable: false,
    };
  if (currentPoint < facts.activationPoint)
    return {
      state: "PAUSED",
      detail: `not yet active: current_point ${currentPoint} < activation_point ${facts.activationPoint}`,
      tradable: false,
    };
  if (facts.migrationProgress === 0)
    return { state: "BONDING", detail: "curve active", tradable: true };
  return {
    state: "UNKNOWN",
    detail: `unrecognised state is_migrated=${facts.isMigrated} migration_progress=${facts.migrationProgress}`,
    tradable: false,
  };
}

export type DbcLifecycleSnapshot = {
  poolAddress: string;
  configAddress: string;
  lifecycle: DbcLifecycleState;
  detail: string;
  tradable: boolean;
  successorStatus: DbcSuccessorStatus;
  successorPoolAddress: string | null;
  successorDetail: string | null;
  slot: number;
  checkedAt: string;
  market: DbcMarketState;
};

/**
 * Read the pool and decide its lifecycle; when GRADUATED, also resolve the
 * DAMM v2 successor from chain. This is the refresh routine the registry
 * refresher and the monitor share.
 */
export async function refreshDbcLifecycle(
  connection: Connection,
  poolAddress: string,
  deps: {
    readMarket?: DbcMarketReader;
    resolveSuccessor?: (market: DbcMarketState) => Promise<SuccessorResolution>;
    successorHint?: string | null;
  } = {},
): Promise<DbcLifecycleSnapshot | null> {
  const read = deps.readMarket ?? ((address) => readDbcMarket(connection, address));
  const market = await read(poolAddress);
  if (!market) return null;
  const facts = dbcFacts(market.pool, market.config);
  const decision = classifyDbcLifecycle(facts, market.currentPoint);

  let successor: SuccessorResolution = { status: "NOT_APPLICABLE", poolAddress: null, detail: null };
  if (decision.state === "GRADUATED") {
    const resolve = deps.resolveSuccessor ?? ((m) => resolveDammV2Successor(connection, m, deps.successorHint ?? null));
    successor = await resolve(market);
  }

  return {
    poolAddress,
    configAddress: market.configAddress,
    lifecycle: decision.state,
    detail: decision.detail,
    tradable: decision.tradable,
    successorStatus: successor.status,
    successorPoolAddress: successor.poolAddress,
    successorDetail: successor.detail,
    slot: market.slot,
    checkedAt: market.readAt,
    market,
  };
}
