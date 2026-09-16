/**
 * DBC Studio deployment (DBC-22) and the mainnet guard (DBC-23).
 *
 * Nothing here signs or sends. `prepareDeployment` builds the one transaction
 * the Meteora SDK produces for "create config + initialize pool", with the
 * connected wallet as payer and creator. The config account and the base mint
 * are new keypairs the *client* generates and keeps; the server only ever sees
 * their public keys. The wallet, the config keypair and the mint keypair are
 * the transaction's three signers, and the client checks that before it asks
 * for a signature.
 *
 * Clusters: localnet, devnet and mainnet. Mainnet requires all of
 *   - HENAR_DBC_MAINNET_DEPLOY=1 in the environment,
 *   - an explicit parameter review: the request carries the hash of the exact
 *     configuration the reviewer saw, and it must match what is built,
 *   - an explicit acknowledgement flag from the reviewer,
 *   - the wallet's own signature on the client.
 * There is no server wallet, no automatic funding and no automatic mainnet
 * deployment path in this package.
 */
import { createHash } from "node:crypto";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { flagEnabled } from "@henar/router-core";
import * as dbc from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildStudioConfig, USDC_DECIMALS, type StudioConfigSummary, type StudioMarketConfig } from "./config";

export type DeployCluster = "localnet" | "devnet" | "mainnet";

export type PoolIdentity = { name: string; symbol: string; uri: string };

export type DeployRequest = {
  cluster: DeployCluster;
  config: StudioMarketConfig;
  pool: PoolIdentity;
  /** The connected wallet: payer, and by default creator, fee claimer and leftover receiver. */
  payer: string;
  poolCreator?: string;
  feeClaimer?: string;
  leftoverReceiver?: string;
  /** Public key of the config keypair the client generated. */
  configAddress: string;
  /** Public key of the base-mint keypair the client generated. */
  baseMint: string;
  /** `reviewHash(config, pool)` computed over what the reviewer was shown. */
  reviewHash: string;
  /** Mainnet only: the reviewer's explicit acknowledgement. */
  mainnetAcknowledged?: boolean;
};

export type PreparedDeployment = {
  cluster: DeployCluster;
  /** Legacy transaction, unsigned, base64. */
  transaction: string;
  configAddress: string;
  baseMint: string;
  poolAddress: string;
  quoteMint: string;
  payer: string;
  requiredSigners: string[];
  /** Every program the transaction invokes, for the client to check. */
  programs: string[];
  blockhash: string | null;
  lastValidBlockHeight: number | null;
  /** "rpc" when the blockhash came from the cluster; "client" when the client must set its own (localnet). */
  blockhashSource: "rpc" | "client";
  summary: StudioConfigSummary;
  reviewHash: string;
  preparedAt: string;
};

/** Programs a config-and-pool creation may legitimately invoke. */
export const STUDIO_ALLOWED_PROGRAMS: readonly string[] = [
  dbc.DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),
  dbc.METAPLEX_PROGRAM_ID.toBase58(),
  "11111111111111111111111111111111", // system
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // associated token
  "ComputeBudget111111111111111111111111111111",
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Canonical JSON: sorted keys at every level, so the hash is order-independent. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** The hash a reviewer signs off on: the configuration and the pool identity, nothing else. */
export function reviewHash(config: StudioMarketConfig, pool: PoolIdentity, cluster: DeployCluster) {
  return createHash("sha256").update(canonicalJson({ cluster, config, pool })).digest("hex");
}

/**
 * Every reason a deployment may not be prepared. Empty means allowed. Pure,
 * so the guard is unit-tested without a cluster.
 */
export function deploymentProblems(request: DeployRequest, environment: Record<string, string | undefined> = process.env): string[] {
  const env = environment as NodeJS.ProcessEnv;
  const problems: string[] = [];
  if (!flagEnabled("dbcStudio", env)) problems.push("HENAR_DBC_STUDIO is off");
  if (!["localnet", "devnet", "mainnet"].includes(request.cluster)) problems.push(`unknown cluster ${request.cluster}`);
  for (const [name, value] of [["payer", request.payer], ["configAddress", request.configAddress], ["baseMint", request.baseMint], ["poolCreator", request.poolCreator ?? request.payer], ["feeClaimer", request.feeClaimer ?? request.payer], ["leftoverReceiver", request.leftoverReceiver ?? request.payer]] as const)
    if (!BASE58.test(value)) problems.push(`${name} is not a public key`);
  if (request.configAddress === request.baseMint) problems.push("config and base mint must be different keypairs");
  if (request.configAddress === request.payer || request.baseMint === request.payer) problems.push("config and base mint must not be the wallet");
  if (!request.pool.name.trim() || request.pool.name.length > 32) problems.push("pool name must be 1–32 characters");
  if (!request.pool.symbol.trim() || request.pool.symbol.length > 10) problems.push("pool symbol must be 1–10 characters");
  if (!/^https?:\/\//.test(request.pool.uri) || request.pool.uri.length > 200) problems.push("pool metadata uri must be an https URL");
  const expectedHash = reviewHash(request.config, request.pool, request.cluster);
  if (request.reviewHash !== expectedHash) problems.push("review hash does not match the configuration being deployed; review the parameters again");
  if (request.cluster === "mainnet") {
    if (!flagEnabled("dbcMainnetDeploy", env)) problems.push("HENAR_DBC_MAINNET_DEPLOY is off: mainnet deployment is not enabled in this environment");
    if (request.mainnetAcknowledged !== true) problems.push("mainnet deployment requires the reviewer's explicit acknowledgement");
  }
  return problems;
}

export type PrepareOptions = {
  /** Supplied for localnet, where the server has no connection to the user's validator. */
  blockhash?: { blockhash: string; lastValidBlockHeight: number } | null;
  now?: number;
};

/**
 * Build the unsigned create-config-and-pool transaction for a reviewed
 * request. Throws with the guard's problems when the request is not allowed;
 * callers surface those verbatim.
 */
export async function prepareDeployment(connection: Connection | null, request: DeployRequest, options: PrepareOptions = {}): Promise<PreparedDeployment> {
  const problems = deploymentProblems(request);
  if (problems.length) throw new Error(problems.join("; "));
  const built = buildStudioConfig(request.config);
  if (!built.ok) throw new Error(`configuration is not valid: ${built.problems.join("; ")}`);
  const quoteMint = new PublicKey(request.config.quoteMint ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const payer = new PublicKey(request.payer);
  const configKey = new PublicKey(request.configAddress);
  const baseMint = new PublicKey(request.baseMint);
  if (!connection && request.cluster !== "localnet") throw new Error(`no RPC connection for ${request.cluster}`);
  const client = dbc.DynamicBondingCurveClient.create(connection ?? new (await import("@solana/web3.js")).Connection("http://127.0.0.1:8899"), "confirmed");
  const tx: Transaction = await client.partner.createConfigAndPool({
    ...built.params,
    config: configKey,
    feeClaimer: new PublicKey(request.feeClaimer ?? request.payer),
    leftoverReceiver: new PublicKey(request.leftoverReceiver ?? request.payer),
    quoteMint,
    payer,
    preCreatePoolParam: {
      name: request.pool.name.trim(),
      symbol: request.pool.symbol.trim(),
      uri: request.pool.uri,
      poolCreator: new PublicKey(request.poolCreator ?? request.payer),
      baseMint,
    },
  });
  tx.feePayer = payer;
  let blockhash: string | null = null;
  let lastValidBlockHeight: number | null = null;
  let blockhashSource: PreparedDeployment["blockhashSource"] = "client";
  if (options.blockhash) {
    ({ blockhash, lastValidBlockHeight } = options.blockhash);
    blockhashSource = "rpc";
  } else if (connection && request.cluster !== "localnet") {
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
    blockhashSource = "rpc";
  }
  // Serialization needs some blockhash; a client-sourced one is replaced before signing.
  tx.recentBlockhash = blockhash ?? "11111111111111111111111111111111";
  const programs = [...new Set(tx.instructions.map((ix) => ix.programId.toBase58()))];
  const foreign = programs.filter((p) => !STUDIO_ALLOWED_PROGRAMS.includes(p));
  if (foreign.length) throw new Error(`SDK transaction invokes unexpected program(s): ${foreign.join(", ")}`);
  const requiredSigners = [...new Set(tx.instructions.flatMap((ix) => ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())))];
  const allowedSigners = new Set([request.payer, request.configAddress, request.baseMint, request.poolCreator ?? request.payer]);
  const foreignSigner = requiredSigners.find((s) => !allowedSigners.has(s));
  if (foreignSigner) throw new Error(`SDK transaction requires an unexpected signer ${foreignSigner}`);
  return {
    cluster: request.cluster,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    configAddress: request.configAddress,
    baseMint: request.baseMint,
    poolAddress: dbc.deriveDbcPoolAddress(quoteMint, baseMint, configKey).toBase58(),
    quoteMint: quoteMint.toBase58(),
    payer: request.payer,
    requiredSigners,
    programs,
    blockhash,
    lastValidBlockHeight,
    blockhashSource,
    summary: built.summary,
    reviewHash: request.reviewHash,
    preparedAt: new Date(options.now ?? Date.now()).toISOString(),
  };
}

export { USDC_DECIMALS };
