/**
 * Synthetic Meteora DAMM v2 pool state for offline tests. Fee bytes are
 * encoded with the SDK's own borsh coder (pod-aligned time scheduler), the
 * sqrt price comes from the SDK's `getSqrtPriceFromPrice`, and liquidity
 * from its concentrated-liquidity helper — so the fixture is a pool the
 * program itself would accept, and `swapQuoteExactInput` is the oracle.
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as cp from "@meteora-ag/cp-amm-sdk";
import { USDC_MINT } from "@henar/router-core";
import type { DammV2MarketState, PoolState } from "@henar/venue-meteora-damm-v2";
import { CURRENT_POINT, mintInspection } from "./meteora-dbc";

export type DammV2FixtureOptions = {
  poolAddress: string;
  tokenAMint: string;
  tokenBMint?: string;
  tokenADecimals?: number;
  tokenBDecimals?: number;
  price?: string;
  feeBps?: number;
  tokenAAmount?: bigint;
  poolStatus?: 0 | 1;
  activationPoint?: bigint;
  tokenAToken2022?: boolean;
  readAt?: string;
  slot?: number;
};

export function buildDammV2Pool(o: DammV2FixtureOptions): PoolState {
  const enc = cp.cpAmmCoder.types.encode("PodAlignedFeeTimeScheduler", {
    cliff_fee_numerator: new BN((o.feeBps ?? 100) * 100_000), // bps → numerator (1e9 denominator)
    base_fee_mode: 0,
    padding: [0, 0, 0, 0, 0],
    number_of_period: 0,
    period_frequency: new BN(0),
    reduction_factor: new BN(0),
  });
  const data = Buffer.alloc(32);
  enc.copy(data, 0);
  const tokenADecimals = o.tokenADecimals ?? 8;
  const tokenBDecimals = o.tokenBDecimals ?? 6;
  const sqrtPrice = cp.getSqrtPriceFromPrice(o.price ?? "5", tokenADecimals, tokenBDecimals);
  const tokenAAmount = new BN((o.tokenAAmount ?? 100_000_000_000_000n).toString());
  const liquidity = cp.getLiquidityDeltaFromAmountAForConcentratedLiquidity(tokenAAmount, sqrtPrice, cp.MAX_SQRT_PRICE);
  const pool = {
    poolFees: {
      baseFee: { baseFeeInfo: { data: Array.from(data) }, padding1: new BN(0) },
      protocolFeePercent: 20,
      padding0: 0,
      referralFeePercent: 0,
      padding1: [0, 0, 0],
      compoundingFeeBps: 0,
      dynamicFee: {
        initialized: 0,
        padding: [],
        maxVolatilityAccumulator: 0,
        variableFeeControl: 0,
        binStep: 0,
        filterPeriod: 0,
        decayPeriod: 0,
        reductionFactor: 0,
        lastUpdateTimestamp: new BN(0),
        binStepU128: new BN(0),
        sqrtPriceReference: new BN(0),
        volatilityAccumulator: new BN(0),
        volatilityReference: new BN(0),
      },
      initSqrtPrice: sqrtPrice,
    },
    tokenAMint: new PublicKey(o.tokenAMint),
    tokenBMint: new PublicKey(o.tokenBMint ?? USDC_MINT),
    tokenAVault: PublicKey.default,
    tokenBVault: PublicKey.default,
    whitelistedVault: PublicKey.default,
    liquidity,
    protocolAFee: new BN(0),
    protocolBFee: new BN(0),
    deadLiquidityFeeCheckpoint: new BN(0),
    sqrtMinPrice: cp.MIN_SQRT_PRICE,
    sqrtMaxPrice: cp.MAX_SQRT_PRICE,
    sqrtPrice,
    activationPoint: new BN((o.activationPoint ?? 0n).toString()),
    activationType: 1,
    poolStatus: o.poolStatus ?? 0,
    tokenAFlag: o.tokenAToken2022 === false ? 0 : 1,
    tokenBFlag: 0,
    collectFeeMode: 0,
    poolType: 0,
    feeVersion: 1,
    padding3: 0,
    feeAPerLiquidity: [],
    feeBPerLiquidity: [],
    permanentLockLiquidity: liquidity,
    metrics: {},
    creator: PublicKey.default,
    tokenAAmount,
    tokenBAmount: new BN(0),
    layoutVersion: 1,
    padding4: [],
    padding5: [],
    rewardInfos: [],
  };
  return pool as unknown as PoolState;
}

export function buildDammV2Market(o: DammV2FixtureOptions): DammV2MarketState {
  return {
    poolAddress: o.poolAddress,
    pool: buildDammV2Pool(o),
    currentPoint: CURRENT_POINT,
    slot: o.slot ?? 300_000_000,
    tokenA: mintInspection(o.tokenAMint, o.tokenADecimals ?? 8, o.tokenAToken2022 !== false),
    tokenB: mintInspection(o.tokenBMint ?? USDC_MINT, o.tokenBDecimals ?? 6, false),
    readAt: o.readAt ?? new Date().toISOString(),
  };
}
