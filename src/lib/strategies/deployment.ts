/**
 * Where a strategy's demo capital lives.
 *
 * Deployments are configured by environment, never committed: an address here
 * would either be wrong or would be a standing claim that Henar funded
 * something it has not. Absent configuration, a strategy is READY_FOR_DEMO
 * with no position, which is the honest state until capital is deployed by
 * hand.
 *
 * No private key is read anywhere in this module. These are public addresses.
 */
import { z } from "zod";

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

const deploymentSchema = z.object({
  /** Holds the capital and its property rights. */
  owner: base58,
  /** May manage the position. Absent where the protocol has no such role. */
  operator: base58.nullable(),
  /** Receives claimed fees. Absent where fees accrue to the owner. */
  feeOwner: base58.nullable(),
  /** Protocol positions to read. Empty until capital is deployed. */
  positions: z.array(base58),
  /** Quote-asset base units deployed, as recorded when funded. */
  deployedCapital: z.string().regex(/^\d+$/).nullable(),
  /** ISO timestamp the position was funded. */
  fundedAt: z.string().nullable(),
  /**
   * Basis recorded at deposit, for a yield strategy. klend keeps no cost
   * basis of its own, so without this realized yield is unknown.
   */
  basis: z
    .object({ collateralAmount: z.string(), exchangeRateAtBasis: z.string(), liquidityAtBasis: z.string(), recordedAt: z.string() })
    .nullable()
    .optional(),
});

export type StrategyDeployment = z.infer<typeof deploymentSchema>;

const ENV_KEYS: Record<string, string> = {
  "earn-stocks": "HENAR_STRATEGY_EARN_STOCKS",
  "smart-accumulate": "HENAR_STRATEGY_SMART_ACCUMULATE",
  "range-yield": "HENAR_STRATEGY_RANGE_YIELD",
};

export type DeploymentResult =
  | { configured: true; deployment: StrategyDeployment }
  | { configured: false; reason: string };

/**
 * Read one strategy's deployment. A malformed value is reported, never
 * partially applied: a half-read deployment would point automation at an
 * address nobody checked.
 */
export function strategyDeployment(slug: string, env: Record<string, string | undefined> = process.env): DeploymentResult {
  const key = ENV_KEYS[slug];
  if (!key) return { configured: false, reason: `no deployment key for ${slug}` };
  const value = env[key]?.trim();
  if (!value) return { configured: false, reason: "no demo capital is deployed for this strategy yet" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { configured: false, reason: `${key} is not valid JSON` };
  }
  const result = deploymentSchema.safeParse(parsed);
  if (!result.success) return { configured: false, reason: `${key} is malformed: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return { configured: true, deployment: result.data };
}

/** True when a strategy has capital deployed and a position to read. */
export function isDeployed(result: DeploymentResult) {
  return result.configured && result.deployment.positions.length > 0;
}
