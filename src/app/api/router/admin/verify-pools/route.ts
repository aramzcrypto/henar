/**
 * Admin: on-chain pool verification, run where RPC exists (Vercel).
 *
 * GET /api/router/admin/verify-pools  (Authorization: Bearer <HENAR_ROUTER_ADMIN_TOKEN>)
 *
 * Reads every registry pool's account and both mint accounts, classifies
 * ONCHAIN_VERIFIED / VERIFICATION_FAILED, and returns the updated registry
 * JSON plus a summary. It does not write anything: Vercel's filesystem is
 * read-only, so the returned JSON is committed to
 * `src/data/router/pools.json` by hand and redeployed. Chain data only; no
 * secrets are touched or returned.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { loadPoolRegistry, verifyPoolsOnchain } from "@henar/router-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const token = process.env.HENAR_ROUTER_ADMIN_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  if (!token || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) return NextResponse.json({ error: "SOLANA_RPC_URL not configured" }, { status: 503 });
  const url = new URL(request.url);
  const onlyEnabled = url.searchParams.get("all") !== "1";
  const registry = loadPoolRegistry();
  const targets = registry.pools.filter((p) => !onlyEnabled || p.enabled);
  const { at, outcomes, updated } = await verifyPoolsOnchain(new Connection(rpc, "confirmed"), targets);
  const byAddress = new Map(updated.map((p) => [p.address, p]));
  const merged = registry.pools.map((p) => byAddress.get(p.address) ?? p);
  const summary = {
    at,
    checked: outcomes.length,
    verified: outcomes.filter((o) => o.verification === "ONCHAIN_VERIFIED").length,
    failed: outcomes.filter((o) => o.verification === "VERIFICATION_FAILED").map((o) => ({ address: o.address, detail: o.detail })),
  };
  return NextResponse.json({ summary, pools: merged }, { headers: { "Cache-Control": "no-store" } });
}
