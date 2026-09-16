/**
 * DBC Studio modeling (DBC-19/20): validate a configuration through the
 * Meteora SDK, and run the liquidity-targeted graduation and fee-profile
 * models. Pure computation; nothing is read from or written to a chain.
 * Behind HENAR_DBC_STUDIO.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { flagEnabled } from "@henar/router-core";
import { STUDIO_PRESETS, buildStudioConfig, recommendFeeProfile, recommendGraduation, reviewHash, type DeployCluster, type GraduationTarget, type StudioMarketConfig } from "@henar/dbc-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const graduation = z.object({
  targetTradeSizeQuote: z.number(),
  maxPriceImpactBps: z.number(),
  referencePriceQuote: z.number(),
  totalTokenSupply: z.number(),
  quoteDecimals: z.number().int(),
  baseDecimals: z.number().int(),
  migrationFeePercentage: z.number(),
});
const feeProfile = z.object({
  expectedVolatility: z.enum(["low", "medium", "high"]),
  liquidity: z.enum(["thin", "moderate", "deep"]),
  maturity: z.enum(["launch", "established"]),
});
const pool = z.object({ name: z.string().max(64), symbol: z.string().max(16), uri: z.string().max(400) });

export async function GET() {
  if (!flagEnabled("dbcStudio")) return NextResponse.json({ error: "DBC Studio is disabled" }, { status: 404 });
  return NextResponse.json({ presets: STUDIO_PRESETS, mainnetDeployEnabled: flagEnabled("dbcMainnetDeploy") });
}

export async function POST(request: Request) {
  if (!flagEnabled("dbcStudio")) return NextResponse.json({ error: "DBC Studio is disabled" }, { status: 404 });
  let body: { config?: StudioMarketConfig; graduation?: GraduationTarget; feeProfile?: z.infer<typeof feeProfile>; pool?: z.infer<typeof pool>; cluster?: DeployCluster };
  try {
    body = (await request.json()) as typeof body;
    if (body.graduation) graduation.parse(body.graduation);
    if (body.feeProfile) feeProfile.parse(body.feeProfile);
    if (body.pool) pool.parse(body.pool);
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const config = body.config ? buildStudioConfig(body.config) : null;
  const configOut = config ? (config.ok ? { ok: true as const, summary: config.summary } : config) : null;
  const hash = body.config && body.pool && body.cluster && config?.ok ? reviewHash(body.config, body.pool, body.cluster) : null;
  return NextResponse.json({
    config: configOut,
    graduation: body.graduation ? recommendGraduation(body.graduation) : null,
    feeProfile: body.feeProfile ? recommendFeeProfile(body.feeProfile) : null,
    reviewHash: hash,
    mainnetDeployEnabled: flagEnabled("dbcMainnetDeploy"),
  });
}
