/**
 * Feature flags for the router and its venues. Every flag is off unless the
 * environment says "1" or "true". Quote flags and execution flags are
 * separate so a venue can be compared long before it is allowed to build.
 *
 * Adapters take an explicit override in their constructor for tests; the
 * environment is only consulted when no override is given.
 */
export const ROUTER_FLAGS = {
  routerQuotes: "HENAR_ROUTER_QUOTES",
  routerExecution: "HENAR_ROUTER_EXECUTION",
  splitRouting: "HENAR_SPLIT_ROUTING",
  privateSubmit: "HENAR_PRIVATE_SUBMIT",
  meteoraDbcQuotes: "HENAR_METEORA_DBC_QUOTES",
  meteoraDbcExecution: "HENAR_METEORA_DBC_EXECUTION",
  meteoraDammV2Quotes: "HENAR_METEORA_DAMM_V2_QUOTES",
  meteoraDammV2Execution: "HENAR_METEORA_DAMM_V2_EXECUTION",
  dbcStudio: "HENAR_DBC_STUDIO",
  dbcMainnetDeploy: "HENAR_DBC_MAINNET_DEPLOY",
} as const;

export type RouterFlag = keyof typeof ROUTER_FLAGS;

export function flagEnabled(flag: RouterFlag, env: NodeJS.ProcessEnv = process.env) {
  const value = env[ROUTER_FLAGS[flag]];
  return value === "1" || value === "true";
}
