/**
 * DBC-20 — Liquidity-Targeted Graduation. MODELED / ESTIMATED.
 *
 * Question answered: how much quote must the bonding curve collect before
 * graduating so that, right after migration, a trade of size T (in quote)
 * moves the price by no more than I (basis points)?
 *
 * Model
 * -----
 * The post-graduation DAMM v2 pool is modeled as a constant-product pool
 * with full-range liquidity holding quote reserve Q and base reserve B at
 * spot price P = Q / B (quote per base).
 *
 * For an exact-in buy of size T in quote (fees ignored):
 *   output      ΔB   = B · T / (Q + T)
 *   execution   T/ΔB = (Q + T) / B
 *   impact      (T/ΔB) / P − 1 = (Q + T) / Q − 1 = T / Q        (exactly)
 *
 * So the pre-fee quote reserve needed for impact I (as a fraction) at trade
 * size T is
 *   Q = T / I
 *
 * The migration fee is taken from the quote collected on the curve before
 * the pool is seeded, so the curve's threshold is grossed up:
 *   threshold = Q / (1 − migrationFeePercentage / 100)
 *
 * Given a reference price P at graduation and a total supply S:
 *   migration market cap        M   = P · S
 *   base seeded into the pool   B   = Q / P
 *   share of supply on migration     = B / S
 *
 * The SDK's `buildCurveWithMarketCap` derives the share of supply on
 * migration from the ratio of initial to migration market cap:
 *   pct = r(1−f)·A / (1 + r(1−f)),  r = sqrt(D / M),  A = 100 − vesting% − leftover%
 * (`calculateAdjustedPercentageSupplyOnMigration`; `getPercentageSupplyOnMigration`
 * when f = 0). Inverting for the initial market cap D that reproduces our B:
 *   x = pct / (A − pct),  r = x / (1 − f),  D = M · r²
 * With no vesting and no leftover, A = 100.
 *
 * Verification inside the function
 *   1. impact is recomputed through the constant-product formula from the
 *      recommended Q and must equal I within 1 bp;
 *   2. the SDK's `getMigrationQuoteAmountFromMigrationQuoteThreshold` applied
 *      to the recommended threshold must return Q;
 *   3. the SDK's `buildCurveWithMarketCap` is called with (D, M) and its
 *      `migrationQuoteThreshold` is reported as `sdkMigrationQuoteThreshold`;
 *      any divergence from the closed form is reported in bps and flagged.
 *
 * Not modeled: concentrated post-migration liquidity, DAMM v2 trading fees,
 * the SDK's actual migration split (locked / vested / leftover), token
 * transfer fees, and anything that happens after the first trade. This is
 * not a guaranteed post-graduation slippage.
 */
import BN from "bn.js";
import Decimal from "decimal.js";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { RawAmount } from "@henar/router-core";

export type GraduationTarget = {
  /** Trade size in quote display units (e.g. USD). */
  targetTradeSizeQuote: number;
  /** Maximum price impact for that trade, in basis points (0 < x < 10000). */
  maxPriceImpactBps: number;
  /** Quote per base token at graduation (e.g. 100 USDC per share-token). */
  referencePriceQuote: number;
  /** Display units of the base token. */
  totalTokenSupply: number;
  quoteDecimals: number;
  baseDecimals: number;
  /** Whole percent (0..MAX_MIGRATION_FEE_PERCENTAGE). */
  migrationFeePercentage: number;
  assumptions?: { postMigrationRange: "full-range" };
};

export type QuoteAmount = { display: string; raw: RawAmount };

export type GraduationRecommendation =
  | {
      ok: true;
      modeled: true;
      label: "MODELED / ESTIMATED";
      /** Q: post-fee quote the pool must hold. */
      requiredQuoteLiquidity: QuoteAmount;
      /** Q grossed up for the migration fee. */
      recommendedMigrationQuoteThreshold: QuoteAmount;
      /** P × totalTokenSupply, quote display units. */
      recommendedMigrationMarketCap: string;
      /** Initial market cap that makes the SDK reproduce this migration split. */
      impliedInitialMarketCap: string | null;
      /** B / totalTokenSupply, percent. */
      impliedPercentageSupplyOnMigration: string;
      /** B: base seeded into the successor pool, display units. */
      impliedBaseReserve: string;
      /** Constant-product impact re-derived from Q, in bps. */
      modeledImpactBpsAtTarget: number;
      /** What `buildCurveWithMarketCap` actually produced for (D, M); null when it could not be built. */
      sdkMigrationQuoteThreshold: QuoteAmount | null;
      /** |sdk − closed form| / closed form, in bps; null when the SDK call failed. */
      sdkDivergenceBps: number | null;
      assumptions: string[];
      caveats: string[];
    }
  | { ok: false; problems: string[] };

const MODEL_ASSUMPTIONS = [
  "Post-graduation pool modeled as constant-product with full-range liquidity: reserves Q (quote) and B (base), spot P = Q/B.",
  "Exact-in buy of T quote: output B·T/(Q+T), execution price (Q+T)/B, impact relative to spot = T/Q exactly, before fees.",
  "Required post-fee quote reserve: Q = T / I where I = maxPriceImpactBps / 10000.",
  "Migration threshold grossed up for the migration fee: threshold = Q / (1 − migrationFeePercentage/100).",
  "Migration market cap = referencePrice × totalTokenSupply; base seeded = Q / referencePrice; supply share on migration = B / totalTokenSupply.",
  "Implied initial market cap inverts the SDK's supply-share formula pct = r(1−f)·100/(1+r(1−f)), r = sqrt(D/M), assuming no locked vesting and no leftover.",
];

const MODEL_CAVEATS = [
  "Concentrated post-migration liquidity is NOT modeled; a DAMM v2 pool with a narrower range has a different impact profile.",
  "DAMM v2 trading fees are NOT modeled; the modeled impact is pre-fee.",
  "The SDK's actual migration split (locked, vested, leftover, partner/creator shares) is NOT modeled; the pool may be seeded with less than Q.",
  "This is a model of the first trade after graduation, not a guaranteed post-graduation slippage.",
];

/** Floor of a display Decimal to raw units of the given decimals. */
function toRawFloor(value: Decimal, decimals: number): RawAmount {
  return value.mul(new Decimal(10).pow(decimals)).floor().toFixed(0);
}

function amount(value: Decimal, decimals: number): QuoteAmount {
  return { display: value.toFixed(decimals, Decimal.ROUND_DOWN), raw: toRawFloor(value, decimals) };
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function recommendGraduation(target: GraduationTarget): GraduationRecommendation {
  const problems: string[] = [];
  if (!positive(target.targetTradeSizeQuote)) problems.push("targetTradeSizeQuote must be positive");
  if (!positive(target.maxPriceImpactBps) || target.maxPriceImpactBps >= 10_000)
    problems.push("maxPriceImpactBps must be greater than 0 and below 10000");
  if (!positive(target.referencePriceQuote)) problems.push("referencePriceQuote must be positive");
  if (!positive(target.totalTokenSupply)) problems.push("totalTokenSupply must be positive");
  if (!Number.isInteger(target.quoteDecimals) || target.quoteDecimals < 0 || target.quoteDecimals > 18) problems.push("quoteDecimals must be an integer in 0..18");
  if (!Number.isInteger(target.baseDecimals) || target.baseDecimals < 0 || target.baseDecimals > 18) problems.push("baseDecimals must be an integer in 0..18");
  if (
    !Number.isInteger(target.migrationFeePercentage) ||
    target.migrationFeePercentage < 0 ||
    target.migrationFeePercentage > dbc.MAX_MIGRATION_FEE_PERCENTAGE
  )
    problems.push(`migrationFeePercentage must be an integer in [0, ${dbc.MAX_MIGRATION_FEE_PERCENTAGE}]`);
  if (target.assumptions && target.assumptions.postMigrationRange !== "full-range")
    problems.push("only postMigrationRange = full-range is modeled");
  if (problems.length) return { ok: false, problems };

  const D = Decimal.clone({ precision: 40 });
  const T = new D(target.targetTradeSizeQuote);
  const I = new D(target.maxPriceImpactBps).div(10_000);
  const P = new D(target.referencePriceQuote);
  const S = new D(target.totalTokenSupply);
  const f = new D(target.migrationFeePercentage).div(100);

  const Q = T.div(I);
  const threshold = Q.div(new D(1).sub(f));
  const M = P.mul(S);
  const B = Q.div(P);
  const pct = B.mul(100).div(S);

  const caveats = [...MODEL_CAVEATS];
  const assumptions = [...MODEL_ASSUMPTIONS];

  // 1. Re-derive the impact through the constant-product formula.
  const deltaB = B.mul(T).div(Q.add(T));
  const execution = T.div(deltaB);
  const impactBps = execution.div(P).sub(1).mul(10_000);
  const modeledImpactBpsAtTarget = Number(impactBps.toFixed(6));
  if (impactBps.sub(target.maxPriceImpactBps).abs().gt(1))
    caveats.push(`internal check failed: re-derived impact ${impactBps.toFixed(4)} bps differs from target ${target.maxPriceImpactBps} bps by more than 1 bp`);

  // 2. The SDK's fee helper must take the threshold back to Q.
  const sdkQuoteAmount = dbc.getMigrationQuoteAmountFromMigrationQuoteThreshold(new Decimal(threshold.toString()), target.migrationFeePercentage);
  if (new D(sdkQuoteAmount.toString()).sub(Q).abs().div(Q).mul(10_000).gt(new D("0.01")))
    caveats.push(`SDK getMigrationQuoteAmountFromMigrationQuoteThreshold(${threshold.toFixed(6)}, ${target.migrationFeePercentage}) = ${sdkQuoteAmount.toString()} does not return Q = ${Q.toFixed(6)}`);

  // Supply share sanity.
  if (pct.gte(100)) caveats.push(`implied supply on migration is ${pct.toFixed(2)}% (≥ 100%): the target cannot be met at this price and supply`);
  else if (pct.lt(10)) caveats.push(`implied supply on migration is ${pct.toFixed(2)}% (< 10%): almost all supply sells on the curve; review the price and supply`);
  else if (pct.gt(80)) caveats.push(`implied supply on migration is ${pct.toFixed(2)}% (> 80%): very little supply is sold on the curve`);

  // 3. Implied initial market cap and SDK read-back.
  let impliedInitialMarketCap: string | null = null;
  let sdkMigrationQuoteThreshold: QuoteAmount | null = null;
  let sdkDivergenceBps: number | null = null;
  if (pct.lt(100) && pct.gt(0)) {
    const x = pct.div(new D(100).sub(pct));
    const r = x.div(new D(1).sub(f));
    // Reported to 6 decimals and fed to the SDK as that same number, so the
    // read-back below is reproducible from the report.
    impliedInitialMarketCap = M.mul(r.pow(2)).toFixed(6);
    const initialCap = new D(impliedInitialMarketCap);
    const baseDecimal = target.baseDecimals as dbc.TokenDecimal;
    const quoteDecimal = target.quoteDecimals as dbc.TokenDecimal;
    try {
      const params = dbc.buildCurveWithMarketCap({
        token: {
          tokenType: dbc.TokenType.Token2022,
          tokenBaseDecimal: baseDecimal,
          tokenQuoteDecimal: quoteDecimal,
          tokenAuthorityOption: dbc.TokenAuthorityOption.Immutable,
          totalTokenSupply: target.totalTokenSupply,
          leftover: 0,
        },
        fee: {
          baseFeeParams: {
            baseFeeMode: dbc.BaseFeeMode.FeeSchedulerLinear,
            feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
          },
          dynamicFeeEnabled: false,
          collectFeeMode: dbc.CollectFeeMode.QuoteToken,
          creatorTradingFeePercentage: 0,
          poolCreationFee: 0,
          enableFirstSwapWithMinFee: false,
        },
        migration: {
          migrationOption: dbc.MigrationOption.MET_DAMM_V2,
          migrationFeeOption: dbc.MigrationFeeOption.FixedBps100,
          migrationFee: { feePercentage: target.migrationFeePercentage, creatorFeePercentage: 0 },
        },
        liquidityDistribution: {
          partnerPermanentLockedLiquidityPercentage: 100,
          partnerLiquidityPercentage: 0,
          creatorPermanentLockedLiquidityPercentage: 0,
          creatorLiquidityPercentage: 0,
        },
        lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
        activationType: dbc.ActivationType.Timestamp,
        initialMarketCap: initialCap.toNumber(),
        migrationMarketCap: M.toNumber(),
      });
      const sdkRaw = new D((params.migrationQuoteThreshold as BN).toString());
      const scale = new D(10).pow(target.quoteDecimals);
      sdkMigrationQuoteThreshold = { raw: sdkRaw.toFixed(0), display: sdkRaw.div(scale).toFixed(target.quoteDecimals) };
      const closedRaw = new D(toRawFloor(threshold, target.quoteDecimals));
      sdkDivergenceBps = Number(sdkRaw.sub(closedRaw).abs().div(closedRaw).mul(10_000).toFixed(6));
      if (sdkDivergenceBps > 1)
        caveats.push(`SDK buildCurveWithMarketCap(initial ${initialCap.toFixed(2)}, migration ${M.toFixed(2)}) produced threshold ${sdkMigrationQuoteThreshold.display}, ${sdkDivergenceBps.toFixed(3)} bps from the closed-form ${threshold.toFixed(target.quoteDecimals)}`);
    } catch (error) {
      caveats.push(`SDK buildCurveWithMarketCap could not build a curve for these caps: ${(error as Error).message}`);
    }
  } else {
    caveats.push("implied initial market cap not derivable: supply share on migration must be strictly between 0% and 100%");
  }

  return {
    ok: true,
    modeled: true,
    label: "MODELED / ESTIMATED",
    requiredQuoteLiquidity: amount(Q, target.quoteDecimals),
    recommendedMigrationQuoteThreshold: amount(threshold, target.quoteDecimals),
    recommendedMigrationMarketCap: M.toFixed(target.quoteDecimals, Decimal.ROUND_DOWN),
    impliedInitialMarketCap,
    impliedPercentageSupplyOnMigration: pct.toFixed(6),
    impliedBaseReserve: B.toFixed(target.baseDecimals, Decimal.ROUND_DOWN),
    modeledImpactBpsAtTarget,
    sdkMigrationQuoteThreshold,
    sdkDivergenceBps,
    assumptions,
    caveats,
  };
}
