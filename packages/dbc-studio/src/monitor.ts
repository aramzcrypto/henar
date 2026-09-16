/**
 * DBC-18 — monitoring model for Meteora DBC markets.
 *
 * A `DbcMarketView` is a flat, serialisable snapshot of one DBC pool: the
 * lifecycle decision, curve position, fee state, migration terms, the DAMM v2
 * successor (when confirmed) and what the registry knows about the pool.
 *
 * Nothing here touches the chain on its own. Reads go through
 * `refreshDbcLifecycle` (pool + config + current point + mints, then the
 * lifecycle rules and successor resolution) and `dbcMetadata` (the same
 * derivations the router puts on a quote), both from
 * `@henar/venue-meteora-dbc`; the successor pool is read through
 * `readDammV2Pool` from `@henar/venue-meteora-damm-v2`. The monitor therefore
 * cannot disagree with the router about a pool's state.
 *
 * Every field that cannot be verified is null. A read failure produces a view
 * with `errors` filled and lifecycle "UNKNOWN"; the monitor never throws for
 * one pool and never guesses.
 */
import type { Connection } from "@solana/web3.js";
import {
  listDbcPools,
  poolByAddress,
  type DbcLifecycleState,
  type DbcSuccessorStatus,
  type PoolEligibility,
  type RawAmount,
  type VerifiedPool,
} from "@henar/router-core";
import {
  dbcMetadata,
  dbcSdk,
  refreshDbcLifecycle,
  type DbcMarketReader,
  type DbcMarketState,
  type SuccessorResolution,
} from "@henar/venue-meteora-dbc";
import {
  POOL_STATUS,
  dammV2Facts,
  enumLabel as dammV2EnumLabel,
  readDammV2Pool,
  type DammV2MarketReader,
  type DammV2MarketState,
} from "@henar/venue-meteora-damm-v2";

export type DbcSuccessorView = {
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  sqrtPrice?: string;
  liquidity?: string;
  /** DAMM v2 `pool_status` label, or null when unrecognised. */
  status: "Enable" | "Disable" | null;
};

export type DbcMarketView = {
  poolAddress: string;
  configAddress: string | null;
  representationId: string | null;
  tokenSymbol: string | null;
  baseMint: string | null;
  quoteMint: string | null;
  lifecycle: DbcLifecycleState;
  lifecycleDetail: string | null;
  tradable: boolean;
  /** Quote per base in display units, from the SDK's sqrt-price helper. */
  currentPrice: string | null;
  quoteReserve: RawAmount | null;
  baseReserve: RawAmount | null;
  migrationQuoteThreshold: RawAmount | null;
  graduationProgressBps: number | null;
  currentFeeBps: number | null;
  baseFeeMode: string | null;
  dynamicFeeEnabled: boolean | null;
  collectFeeMode: string | null;
  activationType: string | null;
  activationPoint: string | null;
  currentPoint: string | null;
  migrationOption: string | null;
  migrationFeeOption: number | null;
  successorStatus: DbcSuccessorStatus;
  successorPoolAddress: string | null;
  successor: DbcSuccessorView | null;
  slot: number | null;
  readAt: string | null;
  /** Registry verification status, or null when the pool is not in the registry. */
  verification: VerifiedPool["verification"] | null;
  /** Registry eligibility, or null when the pool is not in the registry. */
  eligibility: PoolEligibility | null;
  errors: string[];
};

export type MonitorDeps = {
  readMarket?: DbcMarketReader;
  resolveSuccessor?: (market: DbcMarketState) => Promise<SuccessorResolution>;
  readSuccessor?: DammV2MarketReader;
  /** Registry record to describe the pool with; looked up by address when omitted. */
  registryPool?: VerifiedPool | null;
};

function emptyView(poolAddress: string, registry: VerifiedPool | null): DbcMarketView {
  return {
    poolAddress,
    configAddress: registry?.dbc?.configAddress ?? null,
    representationId: registry?.representationId ?? null,
    tokenSymbol: registry?.tokenSymbol ?? null,
    baseMint: registry?.baseMint ?? null,
    quoteMint: registry?.quoteMint ?? null,
    lifecycle: "UNKNOWN",
    lifecycleDetail: null,
    tradable: false,
    currentPrice: null,
    quoteReserve: null,
    baseReserve: null,
    migrationQuoteThreshold: null,
    graduationProgressBps: null,
    currentFeeBps: null,
    baseFeeMode: null,
    dynamicFeeEnabled: null,
    collectFeeMode: null,
    activationType: null,
    activationPoint: null,
    currentPoint: null,
    migrationOption: null,
    migrationFeeOption: null,
    successorStatus: registry?.dbc?.successorStatus ?? "NOT_APPLICABLE",
    successorPoolAddress: registry?.dbc?.successorPoolAddress ?? null,
    successor: null,
    slot: null,
    readAt: null,
    verification: registry?.verification ?? null,
    eligibility: registry?.eligibility ?? null,
    errors: [],
  };
}

function lookupRegistry(poolAddress: string, deps: MonitorDeps, errors: string[]): VerifiedPool | null {
  if (deps.registryPool !== undefined) return deps.registryPool;
  try {
    return poolByAddress(poolAddress);
  } catch (error) {
    errors.push(`registry lookup failed: ${(error as Error).message}`);
    return null;
  }
}

function successorView(market: DammV2MarketState): DbcSuccessorView {
  const facts = dammV2Facts(market.pool);
  return {
    poolAddress: market.poolAddress,
    tokenAMint: facts.tokenAMint,
    tokenBMint: facts.tokenBMint,
    sqrtPrice: facts.sqrtPrice.toString(),
    liquidity: facts.liquidity.toString(),
    status: dammV2EnumLabel(POOL_STATUS, facts.poolStatus),
  };
}

/**
 * Snapshot one DBC pool. `connection` may be null only when every reader is
 * injected (`readMarket`, and `resolveSuccessor`/`readSuccessor` for a
 * graduated pool); otherwise the missing connection is reported in `errors`.
 */
export async function monitorDbcMarket(
  connection: Connection | null,
  poolAddress: string,
  deps: MonitorDeps = {},
): Promise<DbcMarketView> {
  const errors: string[] = [];
  const registry = lookupRegistry(poolAddress, deps, errors);
  const view = emptyView(poolAddress, registry);
  view.errors = errors;

  if (!connection && !deps.readMarket) {
    errors.push("no RPC connection and no market reader");
    return view;
  }
  if (!connection && !deps.resolveSuccessor) {
    // Only matters once GRADUATED; refuse up front so a graduated pool cannot
    // reach the chain-backed resolver with a null connection.
    deps = {
      ...deps,
      resolveSuccessor: async () => ({
        status: "UNRESOLVED",
        poolAddress: null,
        detail: "no RPC connection to resolve the successor",
      }),
    };
  }

  let snapshot;
  try {
    snapshot = await refreshDbcLifecycle(connection as Connection, poolAddress, {
      readMarket: deps.readMarket,
      resolveSuccessor: deps.resolveSuccessor,
      successorHint: registry?.dbc?.successorPoolAddress ?? null,
    });
  } catch (error) {
    errors.push(`market read failed: ${(error as Error).message}`);
    return view;
  }
  if (!snapshot) {
    errors.push("DBC pool account not found on chain");
    return view;
  }

  let meta;
  try {
    const m = await dbcSdk();
    meta = dbcMetadata(m, snapshot.market, {
      nextSqrtPrice: null,
      successorStatus: snapshot.successorStatus,
      successorPoolAddress: snapshot.successorPoolAddress,
    });
  } catch (error) {
    errors.push(`metadata derivation failed: ${(error as Error).message}`);
  }

  view.configAddress = snapshot.configAddress;
  view.lifecycle = snapshot.lifecycle;
  view.lifecycleDetail = snapshot.detail;
  view.tradable = snapshot.tradable;
  view.successorStatus = snapshot.successorStatus;
  view.successorPoolAddress = snapshot.successorPoolAddress;
  if (snapshot.successorDetail && snapshot.successorStatus === "UNRESOLVED")
    errors.push(`successor unresolved: ${snapshot.successorDetail}`);
  view.slot = snapshot.slot;
  view.readAt = snapshot.checkedAt;
  view.baseMint = snapshot.market.pool.poolState.baseMint.toBase58();
  view.quoteMint = snapshot.market.config.quoteMint.toBase58();

  if (meta) {
    view.currentPrice = meta.currentPrice;
    view.quoteReserve = meta.quoteReserve;
    view.baseReserve = meta.baseReserve;
    view.migrationQuoteThreshold = meta.migrationQuoteThreshold;
    view.graduationProgressBps = meta.graduationProgressBps;
    view.currentFeeBps = meta.currentFeeBps;
    view.baseFeeMode = meta.baseFeeMode;
    view.dynamicFeeEnabled = meta.dynamicFeeEnabled;
    view.collectFeeMode = meta.collectFeeMode;
    view.activationType = meta.activationType;
    view.activationPoint = meta.activationPoint;
    view.currentPoint = meta.currentPoint;
    view.migrationOption = meta.migrationOption;
    view.migrationFeeOption = meta.migrationFeeOption;
  }

  if (snapshot.successorStatus === "CONFIRMED" && snapshot.successorPoolAddress) {
    const read = deps.readSuccessor ?? (connection ? (address: string) => readDammV2Pool(connection, address) : null);
    if (!read) errors.push("successor confirmed but no connection or reader to read it");
    else {
      try {
        const successor = await read(snapshot.successorPoolAddress);
        if (successor) view.successor = successorView(successor);
        else errors.push(`successor pool ${snapshot.successorPoolAddress} not found on chain`);
      } catch (error) {
        errors.push(`successor read failed: ${(error as Error).message}`);
      }
    }
  }

  return view;
}

/**
 * Snapshot every DBC pool in the registry (eligible or not). One pool's
 * failure never affects another; it shows up in that view's `errors`.
 */
export async function monitorRegistryDbcMarkets(
  connection: Connection | null,
  options: { pools?: VerifiedPool[]; deps?: MonitorDeps } = {},
): Promise<DbcMarketView[]> {
  const pools = options.pools ?? listDbcPools();
  return Promise.all(
    pools.map((pool) => monitorDbcMarket(connection, pool.address, { ...options.deps, registryPool: pool })),
  );
}
