/**
 * The strategy runner.
 *
 * It reads state, decides whether an action is warranted, and puts the
 * proposal through the safety gate. It does not build swaps of its own: a
 * conversion goes through the Henar Router, which brings the Execution Guard,
 * minimum-output protection, simulation and protected submission with it.
 *
 * Nothing here signs. Execution requires an authorized signer and
 * HENAR_STRATEGY_MAINNET_ACTIONS; the runner's output is a proposal and a
 * record of why it was or was not allowed.
 */
import { henarFlag } from "@/lib/feature-flags";
import { provenance, SOURCES } from "@/lib/provenance";
import { DEFAULT_ACTION_LIMITS, type ActionLimits } from "./config";
import { DEMO_EARN_STOCKS } from "./definitions";
import { evaluateAction, trippedBreakers, type BreakerTrip, type SafetyContext } from "./safety";
import { shouldHarvest, toBig } from "./accounting";
import type { ActivityEntry, ProposedAction, StrategyInstance } from "./types";

export type RunnerDeps = {
  now?: () => number;
  limits?: ActionLimits;
  /** Whether the signer available to the runner holds the operator role. */
  operatorAuthorized?: boolean;
  /**
   * Quote a conversion through the Henar Router. Injected so the runner is
   * testable, and so there is exactly one swap path in the product.
   */
  quoteConversion?: (input: { inputMint: string; outputMint: string; amount: string }) => Promise<{
    available: boolean;
    priceImpactBps: number | null;
    guardApproved: boolean;
    guardReason: string | null;
    expectedOutput: string | null;
    minimumOutput: string | null;
  } | null>;
  /** Actions already executed today, per strategy. */
  actionsToday?: (strategyId: string) => number;
};

export type RunnerResult = {
  instance: StrategyInstance;
  proposals: ProposedAction[];
  breakers: BreakerTrip[];
  /** Set when a breaker means the strategy should stop acting. */
  pause: { pause: boolean; reason: string | null };
  evaluatedAt: string;
};

const mainnetActionsEnabled = () => henarFlag("strategyMainnetActions");

/**
 * What action, if any, a strategy wants right now.
 *
 * Earn Stocks converts realized yield once it is worth converting. Smart
 * Accumulate settles filled orders, which only the owner can sign. Range
 * Yield claims fees once they clear the floor.
 */
export async function evaluateStrategy(instance: StrategyInstance, deps: RunnerDeps = {}): Promise<RunnerResult> {
  const now = deps.now?.() ?? Date.now();
  const limits = deps.limits ?? DEFAULT_ACTION_LIMITS;
  const evaluatedAt = new Date(now).toISOString();
  const proposals: ProposedAction[] = [];

  const stateAgeSeconds = instance.lastUpdatedAt ? (now - Date.parse(instance.lastUpdatedAt)) / 1000 : null;
  const breakers = trippedBreakers({
    poolStateAgeSeconds: stateAgeSeconds,
    maxStateAgeSeconds: limits.maxStateAgeSeconds,
    referenceAvailable: instance.state.kind === "EARN_STOCKS" ? true : instance.state.kind === "SMART_ACCUMULATE" ? instance.state.referencePrice !== null : instance.state.pythFairValue !== null || instance.state.currentPrice !== null,
    deviationBps: null,
    maxDeviationBps: 1_000,
    protocolAvailable: instance.status !== "DEGRADED" || instance.pausedReason === null,
    ownershipMatches: instance.pausedReason?.includes("not owned") ? false : null,
    tokenExtensionsSupported: null,
    consecutiveSimulationFailures: 0,
    maxSimulationFailures: limits.breakerFailureThreshold,
    routeAvailable: null,
    priceImpactBps: null,
    maxPriceImpactBps: limits.maxPriceImpactBps,
    accountingMismatch: instance.pausedReason?.includes("differs from protocol") ? instance.pausedReason : null,
  });

  if (!henarFlag("strategyAutomation"))
    return { instance, proposals, breakers, pause: { pause: breakers.length > 0, reason: breakers[0]?.detail ?? null }, evaluatedAt };

  const baseContext = (amount: bigint, route?: SafetyContext["route"]): SafetyContext => ({
    now,
    limits,
    amount,
    actionsToday: deps.actionsToday?.(instance.id) ?? 0,
    operatorAuthorized: deps.operatorAuthorized ?? false,
    mainnetActionsEnabled: mainnetActionsEnabled(),
    route: route ?? null,
    simulation: null,
    stateAgeSeconds,
  });

  if (instance.state.kind === "EARN_STOCKS") {
    const state = instance.state;
    const accrued = toBig(state.grossYieldAccrued);
    const decision = shouldHarvest({
      accrued,
      minimumAmount: toBig(DEMO_EARN_STOCKS.minimumHarvestAmount),
      maximumAmount: toBig(DEMO_EARN_STOCKS.maximumConversionAmount),
      lastHarvestAt: state.lastConversionAt ? Date.parse(state.lastConversionAt) : null,
      minimumIntervalMs: DEMO_EARN_STOCKS.minimumHarvestIntervalHours * 3_600_000,
      now,
    });
    if (!decision.harvest) {
      proposals.push({
        strategyInstanceId: instance.id,
        action: "CONVERT_YIELD",
        amount: decision.amount.toString(),
        amountMint: DEMO_EARN_STOCKS.yieldAssetMint,
        reason: decision.reason,
        checks: [{ name: "yield.threshold", ok: false, detail: decision.reason }],
        proposedAt: evaluatedAt,
      });
    } else {
      /* The swap is the router's. The runner only decides that one is
         warranted and hands it the exact amount of realized yield. */
      const route = deps.quoteConversion
        ? await deps
            .quoteConversion({ inputMint: DEMO_EARN_STOCKS.yieldAssetMint, outputMint: state.targetStockMint, amount: decision.amount.toString() })
            .catch(() => null)
        : null;
      const evaluated = evaluateAction(instance, baseContext(decision.amount, route ? { available: route.available, priceImpactBps: route.priceImpactBps, guardApproved: route.guardApproved, guardReason: route.guardReason } : null));
      proposals.push({
        strategyInstanceId: instance.id,
        action: "CONVERT_YIELD",
        amount: decision.amount.toString(),
        amountMint: DEMO_EARN_STOCKS.yieldAssetMint,
        reason: evaluated.allowed ? `convert ${decision.amount} of realized yield into ${state.targetStockSymbol}` : (evaluated.reason ?? "blocked"),
        checks: evaluated.checks,
        proposedAt: evaluatedAt,
      });
    }
  }

  if (instance.state.kind === "SMART_ACCUMULATE") {
    const filled = instance.state.levelsFilled;
    /* Settling a filled order requires the owner's signature: Meteora's
       limit orders admit no operator at all. The runner surfaces it and
       stops there. */
    if (filled > 0)
      proposals.push({
        strategyInstanceId: instance.id,
        action: "HARVEST",
        amount: null,
        amountMint: instance.market.assetMint,
        reason: `${filled} level${filled === 1 ? "" : "s"} filled; settlement requires the position owner's signature and cannot be automated`,
        checks: [{ name: "authority.ownerOnly", ok: false, detail: "cancel_limit_order requires owner [SIGNER]; no operator exists for limit orders" }],
        proposedAt: evaluatedAt,
      });
  }

  if (instance.state.kind === "RANGE_YIELD") {
    const fees = toBig(instance.state.feesUnclaimed?.quote ?? "0");
    const minimum = toBig("1000000");
    if (fees > 0n) {
      const evaluated = evaluateAction(instance, baseContext(fees));
      proposals.push({
        strategyInstanceId: instance.id,
        action: "CLAIM_FEES",
        amount: fees.toString(),
        amountMint: instance.market.quoteMint,
        reason: fees < minimum ? `unclaimed fees ${fees} are below the ${minimum} claim floor` : evaluated.allowed ? `claim ${fees} of accrued fees` : (evaluated.reason ?? "blocked"),
        checks: fees < minimum ? [{ name: "fees.threshold", ok: false, detail: `below the ${minimum} floor` }] : evaluated.checks,
        proposedAt: evaluatedAt,
      });
    }
  }

  return { instance, proposals, breakers, pause: { pause: breakers.length > 0, reason: breakers[0]?.detail ?? null }, evaluatedAt };
}

/** A proposal recorded as activity. Nothing is written unless it happened. */
export function activityFromProposal(proposal: ProposedAction, outcome: ActivityEntry["outcome"], extra: { signature?: string | null; slot?: number | null } = {}): ActivityEntry {
  return {
    id: `${proposal.strategyInstanceId}:${proposal.action}:${proposal.proposedAt}`,
    strategyInstanceId: proposal.strategyInstanceId,
    action: proposal.action,
    outcome,
    at: proposal.proposedAt,
    amounts: proposal.amount && proposal.amountMint ? [{ mint: proposal.amountMint, amount: proposal.amount, label: proposal.action === "CONVERT_YIELD" ? "realized yield" : "amount" }] : [],
    reason: proposal.reason,
    signature: extra.signature ?? null,
    slot: extra.slot ?? null,
    provenance: provenance({ ...SOURCES.router, sourceType: "router-quote", observedAt: proposal.proposedAt }),
  };
}
