/**
 * The gate every automated strategy action passes, and the breakers that
 * stop a strategy acting at all.
 *
 * A failed check does not raise and does not retry. It records why the action
 * was skipped, which is the difference between a system that is cautious and
 * one that is broken.
 */
import { CircuitBreaker, DEFAULT_BREAKER } from "@henar/router-app";
import type { ActionLimits } from "./config";
import type { ActionCheck, StrategyInstance } from "./types";

export type SafetyContext = {
  now: number;
  limits: ActionLimits;
  /** Amount the action would move, in base units. */
  amount: bigint;
  /** Actions already executed for this strategy in the rolling day. */
  actionsToday: number;
  /** Whether the signer is authorized for this strategy's operator role. */
  operatorAuthorized: boolean;
  /** Whether mainnet state-changing actions are enabled for this deployment. */
  mainnetActionsEnabled: boolean;
  /** Route facts, when the action needs a swap. */
  route?: { available: boolean; priceImpactBps: number | null; guardApproved: boolean; guardReason: string | null } | null;
  /** Simulation result, when one has been run. */
  simulation?: { ok: boolean; detail: string } | null;
  /** Freshest protocol state, for the staleness check. */
  stateAgeSeconds: number | null;
};

const check = (name: string, ok: boolean, detail: string): ActionCheck => ({ name, ok, detail });

/**
 * Judge a proposed action. Every check is reported whether it passed or not,
 * so a skip can be explained without re-deriving it.
 */
export function evaluateAction(instance: StrategyInstance, ctx: SafetyContext): { allowed: boolean; checks: ActionCheck[]; reason: string | null } {
  const checks: ActionCheck[] = [];

  checks.push(check("strategy.enabled", instance.status === "LIVE_DEMO", `strategy is ${instance.status}`));
  checks.push(check("strategy.notPaused", instance.pausedReason === null, instance.pausedReason ?? "not paused"));
  checks.push(check("operator.authorized", ctx.operatorAuthorized, ctx.operatorAuthorized ? "signer holds the operator role" : "signer is not an authorized operator"));
  checks.push(check("mainnet.enabled", ctx.mainnetActionsEnabled, ctx.mainnetActionsEnabled ? "mainnet actions are enabled" : "HENAR_STRATEGY_MAINNET_ACTIONS is off"));
  checks.push(check("market.verified", instance.market.admittedBecause.length > 0, instance.market.admittedBecause.length ? `market admitted: ${instance.market.admittedBecause[0]}` : "market is not in the verified registry"));

  const fresh = ctx.stateAgeSeconds !== null && ctx.stateAgeSeconds <= ctx.limits.maxStateAgeSeconds;
  checks.push(check("state.fresh", fresh, ctx.stateAgeSeconds === null ? "state age unknown" : `state is ${Math.round(ctx.stateAgeSeconds)}s old (limit ${ctx.limits.maxStateAgeSeconds}s)`));

  const dust = BigInt(ctx.limits.dustThreshold);
  checks.push(check("amount.aboveDust", ctx.amount >= dust, `amount ${ctx.amount} against a ${dust} dust floor`));
  const max = BigInt(ctx.limits.maxActionAmount);
  checks.push(check("amount.withinLimit", ctx.amount <= max, `amount ${ctx.amount} against a ${max} per-action ceiling`));
  checks.push(check("rate.dailyLimit", ctx.actionsToday < ctx.limits.maxActionsPerDay, `${ctx.actionsToday} of ${ctx.limits.maxActionsPerDay} actions used today`));

  if (ctx.route !== undefined && ctx.route !== null) {
    checks.push(check("route.available", ctx.route.available, ctx.route.available ? "a route was found" : "no route is available"));
    const impactOk = ctx.route.priceImpactBps !== null && ctx.route.priceImpactBps <= ctx.limits.maxPriceImpactBps;
    checks.push(check("route.priceImpact", impactOk, ctx.route.priceImpactBps === null ? "price impact unknown" : `impact ${ctx.route.priceImpactBps} bps (limit ${ctx.limits.maxPriceImpactBps})`));
    checks.push(check("route.guard", ctx.route.guardApproved, ctx.route.guardReason ?? "Execution Guard approved the route"));
  }

  if (ctx.simulation !== undefined && ctx.simulation !== null)
    checks.push(check("transaction.simulated", ctx.simulation.ok, ctx.simulation.detail));

  const failed = checks.find((c) => !c.ok) ?? null;
  return { allowed: failed === null, checks, reason: failed ? `${failed.name}: ${failed.detail}` : null };
}

/** Conditions that pause a strategy rather than merely skipping one action. */
export const BREAKER_REASONS = [
  "POOL_STATE_STALE",
  "REFERENCE_UNAVAILABLE",
  "EXTREME_DEVIATION",
  "PROTOCOL_UNAVAILABLE",
  "UNEXPECTED_POSITION_OWNERSHIP",
  "UNSUPPORTED_TOKEN_EXTENSION",
  "SIMULATION_FAILURE",
  "ROUTE_UNAVAILABLE",
  "EXCESSIVE_PRICE_IMPACT",
  "UNEXPECTED_POSITION_BALANCE",
  "ACCOUNTING_MISMATCH",
] as const;
export type BreakerReason = (typeof BREAKER_REASONS)[number];

export type BreakerTrip = { reason: BreakerReason; detail: string };

export type BreakerInput = {
  poolStateAgeSeconds: number | null;
  maxStateAgeSeconds: number;
  referenceAvailable: boolean;
  /** Route price against the reference, in basis points. */
  deviationBps: number | null;
  maxDeviationBps: number;
  protocolAvailable: boolean;
  /** Whether the position is owned by the address the strategy expects. */
  ownershipMatches: boolean | null;
  tokenExtensionsSupported: boolean | null;
  consecutiveSimulationFailures: number;
  maxSimulationFailures: number;
  routeAvailable: boolean | null;
  priceImpactBps: number | null;
  maxPriceImpactBps: number;
  accountingMismatch: string | null;
};

/**
 * Every breaker that has tripped, in the order they are checked. A strategy
 * with any trip is paused; the list is what the operator reads to fix it.
 */
export function trippedBreakers(input: BreakerInput): BreakerTrip[] {
  const trips: BreakerTrip[] = [];
  if (input.poolStateAgeSeconds !== null && input.poolStateAgeSeconds > input.maxStateAgeSeconds)
    trips.push({ reason: "POOL_STATE_STALE", detail: `pool state is ${Math.round(input.poolStateAgeSeconds)}s old` });
  if (!input.referenceAvailable) trips.push({ reason: "REFERENCE_UNAVAILABLE", detail: "no usable price reference" });
  if (input.deviationBps !== null && Math.abs(input.deviationBps) > input.maxDeviationBps)
    trips.push({ reason: "EXTREME_DEVIATION", detail: `price deviates ${input.deviationBps} bps from the reference` });
  if (!input.protocolAvailable) trips.push({ reason: "PROTOCOL_UNAVAILABLE", detail: "the protocol could not be read" });
  if (input.ownershipMatches === false) trips.push({ reason: "UNEXPECTED_POSITION_OWNERSHIP", detail: "the position is not owned by the configured owner" });
  if (input.tokenExtensionsSupported === false) trips.push({ reason: "UNSUPPORTED_TOKEN_EXTENSION", detail: "the mint carries an extension the router cannot settle" });
  if (input.consecutiveSimulationFailures >= input.maxSimulationFailures)
    trips.push({ reason: "SIMULATION_FAILURE", detail: `${input.consecutiveSimulationFailures} consecutive simulation failures` });
  if (input.routeAvailable === false) trips.push({ reason: "ROUTE_UNAVAILABLE", detail: "no route for the strategy's pair" });
  if (input.priceImpactBps !== null && input.priceImpactBps > input.maxPriceImpactBps)
    trips.push({ reason: "EXCESSIVE_PRICE_IMPACT", detail: `price impact ${input.priceImpactBps} bps` });
  if (input.accountingMismatch) trips.push({ reason: "ACCOUNTING_MISMATCH", detail: input.accountingMismatch });
  return trips;
}

/** One breaker per strategy, over the router's implementation. */
export function strategyBreaker(strategyId: string, failureThreshold: number, now: () => number = Date.now) {
  return new CircuitBreaker(`strategy:${strategyId}`, { ...DEFAULT_BREAKER, failureThreshold }, now);
}
