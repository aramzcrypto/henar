/**
 * DBC-19 — Studio configuration engine.
 *
 * `StudioMarketConfig` exposes only settings the current SDK
 * (`@meteora-ag/dynamic-bonding-curve-sdk`) supports for a new config; every
 * field maps onto `BuildCurveWithMarketCapParams`, and the output is the
 * SDK's own `ConfigParameters` from `buildCurveWithMarketCap`, checked by the
 * SDK's `validateConfigParameters` plus a few explicit Studio rules. Nothing
 * here computes a curve by hand.
 *
 * Deprecated modes (`BaseFeeMode.RateLimiter`, `MigrationOption.MET_DAMM`)
 * are refused before the SDK sees them.
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import { USDC_MINT, type RawAmount } from "@henar/router-core";

export const USDC_DECIMALS = 6;

export type StudioTokenDecimals = 6 | 7 | 8 | 9;

/** `BaseFeeParams` with a fee scheduler; flat = same start and end, zero periods. */
export type StudioFeeSchedule = {
  mode: "linear" | "exponential";
  startingFeeBps: number;
  endingFeeBps: number;
  numberOfPeriod: number;
  /** In slots or seconds per `activationType`. */
  totalDuration: number;
};

export type StudioFixedMigrationFeeOption =
  | "FixedBps25"
  | "FixedBps30"
  | "FixedBps100"
  | "FixedBps200"
  | "FixedBps400"
  | "FixedBps600";

export type StudioMigratedPoolFee = {
  poolFeeBps: number;
  collectFeeMode: "QuoteToken" | "OutputToken" | "Compounding";
  dynamicFee: boolean;
};

export type StudioMigrationFeeOption =
  | StudioFixedMigrationFeeOption
  | { customizable: StudioMigratedPoolFee };

export type StudioLiquidityVesting = {
  vestingPercentage: number;
  bpsPerPeriod: number;
  numberOfPeriods: number;
  cliffDurationFromMigrationTime: number;
  totalDuration: number;
};

export type StudioMarketConfig = {
  /** Defaults to USDC. */
  quoteMint?: string;
  /** Defaults to 6 (USDC). */
  quoteDecimals?: StudioTokenDecimals;
  baseTokenType: "SPL" | "Token2022";
  baseDecimals: StudioTokenDecimals;
  /** Mint-authority variants need a transfer-hook config and are not offered. */
  tokenAuthority: "CreatorUpdateAuthority" | "Immutable" | "PartnerUpdateAuthority";
  /** Display units of the base token. */
  totalTokenSupply: number;
  /** Display units of the base token left over after migration. */
  leftover: number;
  /** In quote display units (USD for USDC). */
  initialMarketCap: number;
  migrationMarketCap: number;
  baseFee: StudioFeeSchedule;
  dynamicFeeEnabled: boolean;
  collectFeeMode: "QuoteToken" | "OutputToken";
  creatorTradingFeePercentage: number;
  /** SOL, display units. 0 or within the SDK's bounds. */
  poolCreationFee: number;
  enableFirstSwapWithMinFee?: boolean;
  /** Only DAMM v2 is accepted for new configs. */
  migrationOption: "MET_DAMM_V2";
  migrationFeeOption: StudioMigrationFeeOption;
  /** Whole percent of the migration quote taken as fee (0..MAX_MIGRATION_FEE_PERCENTAGE). */
  migrationFeePercentage: number;
  /** Whole percent of that fee routed to the creator (0..MAX_CREATOR_MIGRATION_FEE_PERCENTAGE). */
  creatorMigrationFeePercentage: number;
  liquidityDistribution: {
    partnerPermanentLockedPercentage: number;
    partnerPercentage: number;
    creatorPermanentLockedPercentage: number;
    creatorPercentage: number;
    partnerVesting?: StudioLiquidityVesting;
    creatorVesting?: StudioLiquidityVesting;
  };
  lockedVesting: {
    totalLockedVestingAmount: number;
    numberOfVestingPeriod: number;
    cliffUnlockAmount: number;
    totalVestingDuration: number;
    cliffDurationFromMigrationTime: number;
  };
  activationType: "Slot" | "Timestamp";
  /**
   * The SDK's validator insists on a non-default leftover receiver even
   * though it is an account, not a config parameter. When omitted a
   * documented placeholder (the DBC program id) is used for validation only;
   * the real receiver is supplied when the config is created on chain.
   */
  leftoverReceiver?: string;
};

export type StudioConfigSummary = {
  quoteMint: string;
  quoteDecimals: number;
  baseDecimals: number;
  totalTokenSupply: { raw: RawAmount; display: string };
  migrationQuoteThreshold: { raw: RawAmount; display: string };
  /** Quote deposited into the DAMM v2 pool after the migration fee. */
  migrationQuoteAmount: { raw: RawAmount; display: string };
  /** Quote per base, display units. */
  initialPrice: string;
  migrationPrice: string;
  /** Base tokens deposited into the successor pool at migration. */
  migrationBaseAmount: { raw: RawAmount; display: string };
  percentageSupplyOnMigration: string;
  migratedPoolFee: { poolFeeBps: number; collectFeeMode: string | null; dynamicFee: boolean };
  migrationFeeOption: string | null;
  baseFeeMode: string | null;
  dynamicFeeEnabled: boolean;
  curvePoints: number;
};

export type StudioConfigResult =
  | { ok: true; params: dbc.ConfigParameters; sdkInput: dbc.BuildCurveWithMarketCapParams; summary: StudioConfigSummary }
  | { ok: false; problems: string[] };

const LEFTOVER_RECEIVER_PLACEHOLDER = dbc.DYNAMIC_BONDING_CURVE_PROGRAM_ID;

const TOKEN_AUTHORITY: Record<StudioMarketConfig["tokenAuthority"], dbc.TokenAuthorityOption> = {
  CreatorUpdateAuthority: dbc.TokenAuthorityOption.CreatorUpdateAuthority,
  Immutable: dbc.TokenAuthorityOption.Immutable,
  PartnerUpdateAuthority: dbc.TokenAuthorityOption.PartnerUpdateAuthority,
};

const FIXED_MIGRATION_FEE: Record<StudioFixedMigrationFeeOption, dbc.MigrationFeeOption> = {
  FixedBps25: dbc.MigrationFeeOption.FixedBps25,
  FixedBps30: dbc.MigrationFeeOption.FixedBps30,
  FixedBps100: dbc.MigrationFeeOption.FixedBps100,
  FixedBps200: dbc.MigrationFeeOption.FixedBps200,
  FixedBps400: dbc.MigrationFeeOption.FixedBps400,
  FixedBps600: dbc.MigrationFeeOption.FixedBps600,
};

const MIGRATED_COLLECT_FEE: Record<StudioMigratedPoolFee["collectFeeMode"], dbc.MigratedCollectFeeMode> = {
  QuoteToken: dbc.MigratedCollectFeeMode.QuoteToken,
  OutputToken: dbc.MigratedCollectFeeMode.OutputToken,
  Compounding: dbc.MigratedCollectFeeMode.Compounding,
};

const MIGRATION_FEE_OPTION_LABELS = ["FixedBps25", "FixedBps30", "FixedBps100", "FixedBps200", "FixedBps400", "FixedBps600", "Customizable"] as const;
const BASE_FEE_MODE_LABELS = ["FeeSchedulerLinear", "FeeSchedulerExponential", "RateLimiter"] as const;
const MIGRATED_COLLECT_FEE_LABELS = ["QuoteToken", "OutputToken", "Compounding"] as const;

function label<T extends readonly string[]>(table: T, value: number): T[number] | null {
  return (table[value] as T[number] | undefined) ?? null;
}

function isDecimals(value: number): value is StudioTokenDecimals {
  return Object.values(dbc.TokenDecimal).includes(value as dbc.TokenDecimal) && Number.isInteger(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function display(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Studio-level rules that run before the SDK builds anything. */
export function validateStudioConfig(input: StudioMarketConfig): string[] {
  const problems: string[] = [];
  const quoteDecimals = input.quoteDecimals ?? USDC_DECIMALS;

  if (input.quoteMint !== undefined) {
    try {
      new PublicKey(input.quoteMint);
    } catch {
      problems.push(`quoteMint ${input.quoteMint} is not a valid public key`);
    }
  }
  if (!isDecimals(quoteDecimals)) problems.push(`quoteDecimals ${quoteDecimals} is not in TokenDecimal (6..9)`);
  if (!isDecimals(input.baseDecimals)) problems.push(`baseDecimals ${input.baseDecimals} is not in TokenDecimal (6..9)`);
  if (input.baseTokenType !== "SPL" && input.baseTokenType !== "Token2022")
    problems.push(`baseTokenType ${String(input.baseTokenType)} is not SPL or Token2022`);
  if (!(input.tokenAuthority in TOKEN_AUTHORITY))
    problems.push(`tokenAuthority ${String(input.tokenAuthority)} is not offered (mint-authority variants need a transfer-hook config)`);

  if (!finite(input.totalTokenSupply) || input.totalTokenSupply <= 0) problems.push("totalTokenSupply must be a positive number");
  if (!finite(input.leftover) || input.leftover < 0) problems.push("leftover must be zero or positive");
  if (finite(input.totalTokenSupply) && finite(input.leftover) && input.leftover >= input.totalTokenSupply)
    problems.push("leftover must be below totalTokenSupply");
  if (!finite(input.initialMarketCap) || input.initialMarketCap <= 0) problems.push("initialMarketCap must be positive");
  if (!finite(input.migrationMarketCap) || input.migrationMarketCap <= 0) problems.push("migrationMarketCap must be positive");
  if (finite(input.initialMarketCap) && finite(input.migrationMarketCap) && input.migrationMarketCap <= input.initialMarketCap)
    problems.push("migrationMarketCap must be greater than initialMarketCap");

  const fee = input.baseFee;
  if (!fee || (fee.mode !== "linear" && fee.mode !== "exponential"))
    problems.push("baseFee.mode must be linear or exponential (RateLimiter is deprecated and refused)");
  else {
    if (!Number.isInteger(fee.startingFeeBps) || fee.startingFeeBps < dbc.MIN_FEE_BPS || fee.startingFeeBps > dbc.MAX_FEE_BPS)
      problems.push(`baseFee.startingFeeBps must be an integer in [${dbc.MIN_FEE_BPS}, ${dbc.MAX_FEE_BPS}]`);
    if (!Number.isInteger(fee.endingFeeBps) || fee.endingFeeBps < dbc.MIN_FEE_BPS || fee.endingFeeBps > dbc.MAX_FEE_BPS)
      problems.push(`baseFee.endingFeeBps must be an integer in [${dbc.MIN_FEE_BPS}, ${dbc.MAX_FEE_BPS}]`);
    if (fee.endingFeeBps > fee.startingFeeBps) problems.push("baseFee.endingFeeBps must not exceed startingFeeBps");
    if (!Number.isInteger(fee.numberOfPeriod) || fee.numberOfPeriod < 0) problems.push("baseFee.numberOfPeriod must be a non-negative integer");
    if (!Number.isInteger(fee.totalDuration) || fee.totalDuration < 0) problems.push("baseFee.totalDuration must be a non-negative integer");
    if (fee.startingFeeBps === fee.endingFeeBps && (fee.numberOfPeriod !== 0 || fee.totalDuration !== 0))
      problems.push("a flat baseFee (start == end) must have numberOfPeriod and totalDuration of 0");
    if (fee.startingFeeBps !== fee.endingFeeBps && (fee.numberOfPeriod === 0 || fee.totalDuration === 0))
      problems.push("a declining baseFee needs numberOfPeriod > 0 and totalDuration > 0");
  }
  if (input.collectFeeMode !== "QuoteToken" && input.collectFeeMode !== "OutputToken")
    problems.push("collectFeeMode must be QuoteToken or OutputToken");
  if (!finite(input.creatorTradingFeePercentage) || input.creatorTradingFeePercentage < 0 || input.creatorTradingFeePercentage > 100)
    problems.push("creatorTradingFeePercentage must be within 0..100");
  if (!finite(input.poolCreationFee) || input.poolCreationFee < 0) problems.push("poolCreationFee must be zero or positive");

  if ((input.migrationOption as string) !== "MET_DAMM_V2")
    problems.push(`migrationOption ${String(input.migrationOption)} is refused; only MET_DAMM_V2 is supported for new configs (MET_DAMM is deprecated)`);
  const mfo = input.migrationFeeOption;
  if (typeof mfo === "string") {
    if (!(mfo in FIXED_MIGRATION_FEE)) problems.push(`migrationFeeOption ${mfo} is not a fixed option`);
  } else if (mfo && typeof mfo === "object" && "customizable" in mfo) {
    const c = mfo.customizable;
    if (!Number.isInteger(c.poolFeeBps) || c.poolFeeBps < dbc.MIN_MIGRATED_POOL_FEE_BPS || c.poolFeeBps > dbc.MAX_MIGRATED_POOL_FEE_BPS)
      problems.push(`customizable migrated pool fee must be an integer in [${dbc.MIN_MIGRATED_POOL_FEE_BPS}, ${dbc.MAX_MIGRATED_POOL_FEE_BPS}] bps`);
    if (!(c.collectFeeMode in MIGRATED_COLLECT_FEE)) problems.push(`customizable collectFeeMode ${String(c.collectFeeMode)} is not recognised`);
  } else problems.push("migrationFeeOption must be a fixed option or { customizable }");
  if (!Number.isInteger(input.migrationFeePercentage) || input.migrationFeePercentage < 0 || input.migrationFeePercentage > dbc.MAX_MIGRATION_FEE_PERCENTAGE)
    problems.push(`migrationFeePercentage must be an integer in [0, ${dbc.MAX_MIGRATION_FEE_PERCENTAGE}]`);
  if (!Number.isInteger(input.creatorMigrationFeePercentage) || input.creatorMigrationFeePercentage < 0 || input.creatorMigrationFeePercentage > dbc.MAX_CREATOR_MIGRATION_FEE_PERCENTAGE)
    problems.push(`creatorMigrationFeePercentage must be an integer in [0, ${dbc.MAX_CREATOR_MIGRATION_FEE_PERCENTAGE}]`);

  const ld = input.liquidityDistribution;
  const parts = [ld.partnerPermanentLockedPercentage, ld.partnerPercentage, ld.creatorPermanentLockedPercentage, ld.creatorPercentage, ld.partnerVesting?.vestingPercentage ?? 0, ld.creatorVesting?.vestingPercentage ?? 0];
  if (parts.some((p) => !finite(p) || p < 0)) problems.push("liquidity distribution percentages must be zero or positive");
  else if (parts.reduce((a, b) => a + b, 0) !== 100) problems.push("liquidity distribution percentages (including vesting) must sum to 100");

  const lv = input.lockedVesting;
  for (const [k, v] of Object.entries(lv)) if (!finite(v) || v < 0) problems.push(`lockedVesting.${k} must be zero or positive`);
  if (input.activationType !== "Slot" && input.activationType !== "Timestamp") problems.push("activationType must be Slot or Timestamp");
  if (input.leftoverReceiver !== undefined) {
    try {
      if (new PublicKey(input.leftoverReceiver).equals(PublicKey.default)) problems.push("leftoverReceiver must not be the default public key");
    } catch {
      problems.push(`leftoverReceiver ${input.leftoverReceiver} is not a valid public key`);
    }
  }
  return problems;
}

/** Map a validated Studio config onto the SDK's builder input. */
export function toSdkInput(input: StudioMarketConfig): dbc.BuildCurveWithMarketCapParams {
  const mfo = input.migrationFeeOption;
  const migratedPoolFee: dbc.MigratedPoolFeeConfig | undefined =
    typeof mfo === "string"
      ? undefined
      : {
          collectFeeMode: MIGRATED_COLLECT_FEE[mfo.customizable.collectFeeMode],
          dynamicFee: mfo.customizable.dynamicFee ? dbc.DammV2DynamicFeeMode.Enabled : dbc.DammV2DynamicFeeMode.Disabled,
          poolFeeBps: mfo.customizable.poolFeeBps,
        };
  const ld = input.liquidityDistribution;
  return {
    token: {
      tokenType: input.baseTokenType === "Token2022" ? dbc.TokenType.Token2022 : dbc.TokenType.SPLToken,
      tokenBaseDecimal: input.baseDecimals as dbc.TokenDecimal,
      tokenQuoteDecimal: (input.quoteDecimals ?? USDC_DECIMALS) as dbc.TokenDecimal,
      tokenAuthorityOption: TOKEN_AUTHORITY[input.tokenAuthority],
      totalTokenSupply: input.totalTokenSupply,
      leftover: input.leftover,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: input.baseFee.mode === "exponential" ? dbc.BaseFeeMode.FeeSchedulerExponential : dbc.BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: input.baseFee.startingFeeBps,
          endingFeeBps: input.baseFee.endingFeeBps,
          numberOfPeriod: input.baseFee.numberOfPeriod,
          totalDuration: input.baseFee.totalDuration,
        },
      },
      dynamicFeeEnabled: input.dynamicFeeEnabled,
      collectFeeMode: input.collectFeeMode === "OutputToken" ? dbc.CollectFeeMode.OutputToken : dbc.CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: input.creatorTradingFeePercentage,
      poolCreationFee: input.poolCreationFee,
      enableFirstSwapWithMinFee: input.enableFirstSwapWithMinFee ?? false,
    },
    migration: {
      migrationOption: dbc.MigrationOption.MET_DAMM_V2,
      migrationFeeOption: typeof mfo === "string" ? FIXED_MIGRATION_FEE[mfo] : dbc.MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: input.migrationFeePercentage, creatorFeePercentage: input.creatorMigrationFeePercentage },
      ...(migratedPoolFee ? { migratedPoolFee } : {}),
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: ld.partnerPermanentLockedPercentage,
      partnerLiquidityPercentage: ld.partnerPercentage,
      creatorPermanentLockedLiquidityPercentage: ld.creatorPermanentLockedPercentage,
      creatorLiquidityPercentage: ld.creatorPercentage,
      ...(ld.partnerVesting ? { partnerLiquidityVestingInfoParams: ld.partnerVesting } : {}),
      ...(ld.creatorVesting ? { creatorLiquidityVestingInfoParams: ld.creatorVesting } : {}),
    },
    lockedVesting: { ...input.lockedVesting },
    activationType: input.activationType === "Slot" ? dbc.ActivationType.Slot : dbc.ActivationType.Timestamp,
    initialMarketCap: input.initialMarketCap,
    migrationMarketCap: input.migrationMarketCap,
  };
}

/** Human-readable facts read back from the SDK's `ConfigParameters`. */
export function summarizeConfigParameters(
  params: dbc.ConfigParameters,
  sdkInput: dbc.BuildCurveWithMarketCapParams,
  quoteMint: string,
): StudioConfigSummary {
  const baseDecimals = Number(params.tokenDecimal);
  const quoteDecimals = Number(sdkInput.token.tokenQuoteDecimal);
  const threshold = BigInt(params.migrationQuoteThreshold.toString());
  const totalSupply = BigInt((params.tokenSupply?.postMigrationTokenSupply ?? new BN(0)).toString());
  const sqrtMigration = dbc.getMigrationThresholdPrice(params.migrationQuoteThreshold, params.sqrtStartPrice, params.curve);
  const quoteAmountRaw = BigInt(
    dbc
      .getMigrationQuoteAmountFromMigrationQuoteThreshold(new Decimal(threshold.toString()), params.migrationFee.feePercentage)
      .floor()
      .toFixed(0),
  );
  const migrationBase = BigInt(
    dbc.getMigrationBaseToken(new BN(quoteAmountRaw.toString()), sqrtMigration, Number(params.migrationOption) as dbc.MigrationOption).toString(),
  );
  const pct = totalSupply > 0n ? new Decimal(migrationBase.toString()).mul(100).div(totalSupply.toString()).toFixed(4) : "0";
  return {
    quoteMint,
    quoteDecimals,
    baseDecimals,
    totalTokenSupply: { raw: totalSupply.toString(), display: display(totalSupply, baseDecimals) },
    migrationQuoteThreshold: { raw: threshold.toString(), display: display(threshold, quoteDecimals) },
    migrationQuoteAmount: { raw: quoteAmountRaw.toString(), display: display(quoteAmountRaw, quoteDecimals) },
    initialPrice: dbc.getPriceFromSqrtPrice(params.sqrtStartPrice, baseDecimals, quoteDecimals).toFixed(12),
    migrationPrice: dbc.getPriceFromSqrtPrice(sqrtMigration, baseDecimals, quoteDecimals).toFixed(12),
    migrationBaseAmount: { raw: migrationBase.toString(), display: display(migrationBase, baseDecimals) },
    percentageSupplyOnMigration: pct,
    migratedPoolFee: {
      poolFeeBps: Number(params.migratedPoolFee.poolFeeBps),
      collectFeeMode: label(MIGRATED_COLLECT_FEE_LABELS, Number(params.migratedPoolFee.collectFeeMode)),
      dynamicFee: Number(params.migratedPoolFee.dynamicFee) === dbc.DammV2DynamicFeeMode.Enabled,
    },
    migrationFeeOption: label(MIGRATION_FEE_OPTION_LABELS, Number(params.migrationFeeOption)),
    baseFeeMode: label(BASE_FEE_MODE_LABELS, Number(params.poolFees.baseFee.baseFeeMode)),
    dynamicFeeEnabled: params.poolFees.dynamicFee !== null && params.poolFees.dynamicFee !== undefined,
    curvePoints: params.curve.length,
  };
}

/**
 * Build and validate. Studio rules first (cheap, explicit), then the SDK's
 * builder and validator; any SDK throw is surfaced as a problem.
 */
export function buildStudioConfig(input: StudioMarketConfig): StudioConfigResult {
  const problems = validateStudioConfig(input);
  if (problems.length) return { ok: false, problems };

  const sdkInput = toSdkInput(input);
  let params: dbc.ConfigParameters;
  try {
    params = dbc.buildCurveWithMarketCap(sdkInput);
  } catch (error) {
    return { ok: false, problems: [`SDK buildCurveWithMarketCap: ${(error as Error).message}`] };
  }
  // The SDK's validator checks the deprecated modes again (assertConfigAllowsNewPool).
  try {
    dbc.validateConfigParameters({
      ...params,
      leftoverReceiver: input.leftoverReceiver ? new PublicKey(input.leftoverReceiver) : LEFTOVER_RECEIVER_PLACEHOLDER,
    });
  } catch (error) {
    return { ok: false, problems: [`SDK validateConfigParameters: ${(error as Error).message}`] };
  }

  let summary: StudioConfigSummary;
  try {
    summary = summarizeConfigParameters(params, sdkInput, input.quoteMint ?? USDC_MINT);
  } catch (error) {
    return { ok: false, problems: [`summary derivation: ${(error as Error).message}`] };
  }
  return { ok: true, params, sdkInput, summary };
}

/**
 * Presets are starting points for an equity-style token paired with USDC.
 * They are plain data — not recommendations, not tuned to any issuer — and
 * every field is meant to be reviewed before use.
 */
export const STUDIO_PRESETS: Readonly<Record<"conservativeBootstrap" | "standard", { label: string; description: string; config: StudioMarketConfig }>> = {
  conservativeBootstrap: {
    label: "Conservative bootstrap",
    description:
      "Small launch that graduates early into a fully locked DAMM v2 pool: modest caps, a declining fee to discourage sniping in the first hour, dynamic fee on, 1% migration fee.",
    config: {
      quoteMint: USDC_MINT,
      quoteDecimals: USDC_DECIMALS,
      baseTokenType: "Token2022",
      baseDecimals: 8,
      tokenAuthority: "Immutable",
      totalTokenSupply: 1_000_000,
      leftover: 0,
      initialMarketCap: 2_000_000,
      migrationMarketCap: 5_000_000,
      baseFee: { mode: "exponential", startingFeeBps: 500, endingFeeBps: 100, numberOfPeriod: 12, totalDuration: 3600 },
      dynamicFeeEnabled: true,
      collectFeeMode: "QuoteToken",
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      migrationOption: "MET_DAMM_V2",
      migrationFeeOption: "FixedBps100",
      migrationFeePercentage: 1,
      creatorMigrationFeePercentage: 0,
      liquidityDistribution: { partnerPermanentLockedPercentage: 100, partnerPercentage: 0, creatorPermanentLockedPercentage: 0, creatorPercentage: 0 },
      lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
      activationType: "Timestamp",
    },
  },
  standard: {
    label: "Standard",
    description:
      "Flat 1% base fee, dynamic fee on, larger caps and a 30 bps migrated pool; half the post-migration liquidity permanently locked by the partner and half by the creator.",
    config: {
      quoteMint: USDC_MINT,
      quoteDecimals: USDC_DECIMALS,
      baseTokenType: "Token2022",
      baseDecimals: 8,
      tokenAuthority: "Immutable",
      totalTokenSupply: 10_000_000,
      leftover: 0,
      initialMarketCap: 20_000_000,
      migrationMarketCap: 50_000_000,
      baseFee: { mode: "linear", startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
      dynamicFeeEnabled: true,
      collectFeeMode: "QuoteToken",
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      migrationOption: "MET_DAMM_V2",
      migrationFeeOption: "FixedBps30",
      migrationFeePercentage: 0,
      creatorMigrationFeePercentage: 0,
      liquidityDistribution: { partnerPermanentLockedPercentage: 50, partnerPercentage: 0, creatorPermanentLockedPercentage: 50, creatorPercentage: 0 },
      lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
      activationType: "Timestamp",
    },
  },
};
