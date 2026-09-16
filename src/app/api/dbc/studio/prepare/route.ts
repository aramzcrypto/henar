/**
 * DBC Studio deployment (DBC-22) with the mainnet guard (DBC-23).
 *
 * Requires an admin wallet session (the same signed challenge as /admin) and
 * returns one unsigned transaction for the reviewed configuration. The config
 * and base-mint keypairs live in the caller's browser; the payer is the
 * caller's wallet. Mainnet additionally requires HENAR_DBC_MAINNET_DEPLOY=1,
 * a matching review hash and the reviewer's explicit acknowledgement, all
 * checked in `deploymentProblems`. Nothing is signed or sent here.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { flagEnabled } from "@henar/router-core";
import { deploymentProblems, prepareDeployment, type DeployRequest } from "@henar/dbc-studio";
import { PRIVATE_HEADERS, allowedAdminWallets, verifyAdminProof } from "@/lib/admin/auth";
import { protocolContext } from "@/lib/protocol/context";
import { rateLimitedConnection } from "@/lib/rpc-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  cluster: z.enum(["localnet", "devnet", "mainnet"]),
  config: z.record(z.string(), z.unknown()),
  pool: z.object({ name: z.string().max(64), symbol: z.string().max(16), uri: z.string().max(400) }),
  payer: z.string().max(44),
  poolCreator: z.string().max(44).optional(),
  feeClaimer: z.string().max(44).optional(),
  leftoverReceiver: z.string().max(44).optional(),
  configAddress: z.string().max(44),
  baseMint: z.string().max(44),
  reviewHash: z.string().length(64),
  mainnetAcknowledged: z.boolean().optional(),
});

function clusterRpc(cluster: DeployRequest["cluster"]) {
  if (cluster === "mainnet") return process.env.SOLANA_RPC_URL ?? null;
  if (cluster === "devnet") return process.env.HENAR_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
  return null;
}

export async function POST(request: Request) {
  if (!flagEnabled("dbcStudio")) return NextResponse.json({ error: "DBC Studio is disabled" }, { status: 404 });
  const authorization = request.headers.get("authorization");
  if (!authorization) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401, headers: PRIVATE_HEADERS });
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  let wallet: string | null;
  try {
    const { config } = await protocolContext();
    wallet = verifyAdminProof(authorization, new URL(request.url).origin, allowedAdminWallets(config.admin.toBase58()));
  } catch {
    wallet = null;
  }
  if (!wallet) return NextResponse.json({ error: "Admin session expired or unauthorized." }, { status: 401, headers: PRIVATE_HEADERS });
  // The signed-in admin must be the payer: nobody prepares a deployment for someone else's wallet.
  if (wallet !== input.payer) return NextResponse.json({ error: "payer must be the signed-in admin wallet" }, { status: 403, headers: PRIVATE_HEADERS });
  const deploy = input as unknown as DeployRequest;
  const problems = deploymentProblems(deploy);
  if (problems.length) return NextResponse.json({ error: "deployment not allowed", problems }, { status: 403, headers: PRIVATE_HEADERS });
  const rpc = clusterRpc(deploy.cluster);
  if (!rpc && deploy.cluster !== "localnet") return NextResponse.json({ error: `no RPC configured for ${deploy.cluster}` }, { status: 503, headers: PRIVATE_HEADERS });
  try {
    const prepared = await prepareDeployment(rpc ? rateLimitedConnection(rpc) : null, deploy);
    return NextResponse.json(prepared, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409, headers: PRIVATE_HEADERS });
  }
}
