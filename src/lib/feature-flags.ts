/**
 * Product-level feature flags for the Pyth Pro and private-market surfaces.
 *
 * Router execution flags live in `@henar/router-core` (`ROUTER_FLAGS`) and
 * stay off unless explicitly enabled. The flags here follow the same shape,
 * with one deliberate difference: read-only product surfaces (Pyth market
 * data, the Pre-IPO Markets pages) default ON and can be switched off, while
 * anything that changes what the router will quote or how the guard judges a
 * trade defaults OFF and must be switched on.
 */
export const HENAR_FLAGS = {
  /** Pyth Pro market data on Markets and Trade (read-only). */
  pythPro: "HENAR_PYTH_PRO",
  /** Feed the Pyth fair-value assessment into the Execution Guard. */
  pythFairValueGuard: "HENAR_PYTH_FAIR_VALUE_GUARD",
  /** Pyth WebSocket streaming inside the always-on router worker. */
  pythStreaming: "HENAR_PYTH_STREAMING",
  /** Markets → Pre-IPO pages and the Pre-IPO selector category. */
  preIpoMarkets: "HENAR_PREIPO_MARKETS",
  /** Markets → Issuers: the issuer comparison and per-issuer intelligence. */
  issuerIntelligence: "HENAR_ISSUER_INTELLIGENCE",
  /** Register verified private-market products with the Henar Router. */
  privateMarketsRouting: "HENAR_PRIVATE_MARKETS_ROUTING",
  /** The Earn strategy framework and its pages. */
  earnStrategies: "HENAR_EARN_STRATEGIES",
  earnStocks: "HENAR_EARN_STOCKS",
  smartAccumulate: "HENAR_SMART_ACCUMULATE",
  rangeYield: "HENAR_RANGE_YIELD",
  /** Let the strategy runner evaluate and propose actions. */
  strategyAutomation: "HENAR_STRATEGY_AUTOMATION",
  /** Let an authorized action actually touch mainnet. Off, and audited by hand. */
  strategyMainnetActions: "HENAR_STRATEGY_MAINNET_ACTIONS",
  /** Public capital. Not implemented; the flag exists so its absence is explicit. */
  publicStrategyDeposits: "HENAR_PUBLIC_STRATEGY_DEPOSITS",
} as const;

export type HenarFlag = keyof typeof HENAR_FLAGS;

/* Read-only surfaces default on. Anything that moves capital, or that would
   accept someone else's, defaults off and must be switched on deliberately. */
const DEFAULT_ON: ReadonlySet<HenarFlag> = new Set<HenarFlag>([
  "pythPro",
  "pythFairValueGuard",
  "preIpoMarkets",
  "issuerIntelligence",
  "earnStrategies",
  "earnStocks",
  "smartAccumulate",
  "rangeYield",
]);

export function henarFlag(flag: HenarFlag, env: Record<string, string | undefined> = process.env) {
  const value = env[HENAR_FLAGS[flag]];
  if (value === undefined || value === "") return DEFAULT_ON.has(flag);
  return value === "1" || value === "true";
}

export type PythGuardMode = "observe" | "warn" | "enforce";

/**
 * How the Execution Guard treats the Pyth fair-value checks. `observe`
 * records the assessment without affecting the verdict; `warn` does the
 * same but surfaces the state prominently; `enforce` lets a deviation or
 * a low-quality reference refuse the trade. A missing reference never
 * refuses in any mode: existing Henar rules stay authoritative.
 */
export function pythGuardMode(env: Record<string, string | undefined> = process.env): PythGuardMode {
  const value = env.HENAR_PYTH_GUARD_MODE;
  return value === "warn" || value === "enforce" ? value : "observe";
}
