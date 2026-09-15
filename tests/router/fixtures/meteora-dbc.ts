/**
 * Synthetic Meteora DBC market state for offline tests.
 *
 * The config comes from the SDK's own `buildCurveWithMarketCap`, so the
 * curve, fees and migration threshold are exactly what Meteora would create
 * for those parameters. The pool account is assembled to match the IDL's
 * `PoolState`, starting at the curve's first sqrt price with an empty quote
 * reserve. Tests then move the pool along the curve by applying the SDK's
 * own `nextSqrtPrice`, never by hand-computing prices.
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { USDC_MINT, type MintInspection } from "@henar/router-core";
import type { DbcMarketState, PoolConfig, VirtualPool } from "@henar/venue-meteora-dbc";

export const CURRENT_POINT = 1_800_000_000n; // timestamp activation

export function mintInspection(mint: string, decimals: number, token2022: boolean, overrides: Partial<MintInspection> = {}): MintInspection {
  return {
    mint,
    program: (token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID).toBase58(),
    decimals,
    isToken2022: token2022,
    extensions: [],
    transferFeeBps: null,
    transferHookProgram: null,
    scaledUiMultiplier: null,
    permanentDelegate: null,
    nonTransferable: false,
    supported: true,
    unsupportedReason: null,
    readAt: new Date().toISOString(),
    ...overrides,
  };
}

export type DbcFixtureOptions = {
  poolAddress: string;
  configAddress: string;
  baseMint: string;
  quoteMint?: string;
  baseDecimals?: 6 | 7 | 8 | 9;
  quoteDecimals?: 6 | 7 | 8 | 9;
  baseFeeBps?: number;
  initialMarketCap?: number;
  migrationMarketCap?: number;
  totalTokenSupply?: number;
  activationPoint?: bigint;
  migrationFeeOption?: number;
  readAt?: string;
  slot?: number;
  baseToken2022?: boolean;
};

export function buildDbcConfig(o: DbcFixtureOptions): PoolConfig {
  const built = dbc.buildCurveWithMarketCap({
    token: {
      tokenType: o.baseToken2022 === false ? dbc.TokenType.SPLToken : dbc.TokenType.Token2022,
      tokenBaseDecimal: (o.baseDecimals ?? 8) as dbc.TokenDecimal,
      tokenQuoteDecimal: (o.quoteDecimals ?? 6) as dbc.TokenDecimal,
      tokenAuthorityOption: 0,
      totalTokenSupply: o.totalTokenSupply ?? 1_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: dbc.BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: o.baseFeeBps ?? 100, endingFeeBps: o.baseFeeBps ?? 100, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: dbc.CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: dbc.MigrationOption.MET_DAMM_V2,
      migrationFeeOption: (o.migrationFeeOption ?? dbc.MigrationFeeOption.FixedBps100) as dbc.MigrationFeeOption,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 100 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: dbc.ActivationType.Timestamp,
    initialMarketCap: o.initialMarketCap ?? 5_000_000,
    migrationMarketCap: o.migrationMarketCap ?? 20_000_000,
  });
  const curve = [...built.curve];
  while (curve.length < 20) curve.push({ sqrtPrice: new BN(0), liquidity: new BN(0) });
  const last = built.curve[built.curve.length - 1].sqrtPrice;
  const config = {
    ...built,
    curve,
    migrationSqrtPrice: last,
    quoteMint: new PublicKey(o.quoteMint ?? USDC_MINT),
    quoteTokenFlag: 0,
    version: 0,
    migrationBaseThreshold: new BN(0),
    swapBaseAmount: new BN(0),
    feeClaimer: PublicKey.default,
    leftoverReceiver: PublicKey.default,
    poolFees: {
      baseFee: {
        cliffFeeNumerator: built.poolFees.baseFee.cliffFeeNumerator,
        firstFactor: built.poolFees.baseFee.firstFactor,
        secondFactor: new BN(0),
        thirdFactor: new BN(0),
        baseFeeMode: built.poolFees.baseFee.baseFeeMode,
        padding0: [],
      },
      dynamicFee: {
        ...(built.poolFees.dynamicFee ?? {}),
        initialized: 1,
        binStepU128: new BN((built.poolFees.dynamicFee?.binStepU128 as unknown as string) ?? "0", 16),
        padding: [],
        padding2: [],
      },
    },
  };
  return config as unknown as PoolConfig;
}

export function buildDbcPool(o: DbcFixtureOptions, config: PoolConfig, overrides: Partial<VirtualPool["poolState"]> = {}): VirtualPool {
  const poolState = {
    volatilityTracker: {
      lastUpdateTimestamp: new BN(0),
      padding: [],
      sqrtPriceReference: new BN(0),
      volatilityAccumulator: new BN(0),
      volatilityReference: new BN(0),
    },
    config: new PublicKey(o.configAddress),
    creator: PublicKey.default,
    baseMint: new PublicKey(o.baseMint),
    baseVault: PublicKey.default,
    quoteVault: PublicKey.default,
    baseReserve: new BN("100000000000000"),
    quoteReserve: new BN(0),
    protocolBaseFee: new BN(0),
    protocolQuoteFee: new BN(0),
    partnerBaseFee: new BN(0),
    partnerQuoteFee: new BN(0),
    sqrtPrice: config.sqrtStartPrice,
    activationPoint: new BN((o.activationPoint ?? 0n).toString()),
    poolType: o.baseToken2022 === false ? 0 : 1,
    isMigrated: 0,
    isPartnerWithdrawSurplus: 0,
    isProtocolWithdrawSurplus: 0,
    migrationProgress: 0,
    isWithdrawLeftover: 0,
    isCreatorWithdrawSurplus: 0,
    migrationFeeWithdrawStatus: 0,
    metrics: {
      totalProtocolBaseFee: new BN(0),
      totalProtocolQuoteFee: new BN(0),
      totalTradingBaseFee: new BN(0),
      totalTradingQuoteFee: new BN(0),
    },
    finishCurveTimestamp: new BN(0),
    creatorBaseFee: new BN(0),
    creatorQuoteFee: new BN(0),
    legacyCreationFeeBits: 0,
    creationFeeBits: 0,
    hasSwap: 0,
    ...overrides,
  };
  return { poolState } as unknown as VirtualPool;
}

export function buildDbcMarket(o: DbcFixtureOptions, poolOverrides: Partial<VirtualPool["poolState"]> = {}, mintOverrides: { base?: Partial<MintInspection>; quote?: Partial<MintInspection> } = {}): DbcMarketState {
  const config = buildDbcConfig(o);
  const pool = buildDbcPool(o, config, poolOverrides);
  return {
    poolAddress: o.poolAddress,
    configAddress: o.configAddress,
    pool,
    config,
    currentPoint: CURRENT_POINT,
    slot: o.slot ?? 300_000_000,
    baseMint: mintInspection(o.baseMint, o.baseDecimals ?? 8, o.baseToken2022 !== false, mintOverrides.base),
    quoteMint: mintInspection(o.quoteMint ?? USDC_MINT, o.quoteDecimals ?? 6, false, mintOverrides.quote),
    readAt: o.readAt ?? new Date().toISOString(),
  };
}

/** Advance a market by applying a buy through the SDK; returns the new market. */
export function afterBuy(market: DbcMarketState, quoteIn: bigint): DbcMarketState {
  const q = dbc.swapQuoteExactIn(market.pool, market.config, false, new BN(quoteIn.toString()), 0, false, new BN(CURRENT_POINT.toString()), false);
  const poolState = {
    ...market.pool.poolState,
    sqrtPrice: q.nextSqrtPrice,
    quoteReserve: market.pool.poolState.quoteReserve.add(q.excludedFeeInputAmount),
    baseReserve: market.pool.poolState.baseReserve.sub(q.outputAmount),
    hasSwap: 1,
  };
  return { ...market, pool: { poolState } as unknown as VirtualPool };
}
