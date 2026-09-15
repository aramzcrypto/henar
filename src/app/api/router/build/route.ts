/**
 * Henar Router build (Task 24 execution path) — behind HENAR_ROUTER_QUOTES,
 * HENAR_ROUTER_UI and HENAR_ROUTER_EXECUTION, and the same signed wallet
 * session + per-wallet budget as /api/market.
 *
 * Stateless: quotes fresh, guards, plans and builds in one call. Returns an
 * unsigned v0 transaction plus the plan the client validates it against
 * before asking the wallet to sign. Nothing is submitted here.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { flagEnabled, poolsForRepresentation, routerRepresentationForMint, telemetrySinkFromEnv, type PlannedLeg, type BuildOptions } from "@henar/router-core";
import { RouterApi } from "@henar/router-app";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";
import { consumeQuoteBudget, verifyQuoteAccess } from "@/lib/wallet-access-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const adapters = [jupiterAdapter, raydiumAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter];
let api: RouterApi | null = null;

function routerApi(connection: Connection) {
  if (api) return api;
  api = new RouterApi({
    adapters,
    connection,
    health: null,
    telemetry: telemetrySinkFromEnv(),
    treasuryOwner: process.env.STOCKROOM_TREASURY_OWNER ?? null,
    blockhash: {
      async latest() {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        return { blockhash, lastValidBlockHeight, source: "rpc" as const };
      },
    },
    legBuilder: async (leg: PlannedLeg, options: BuildOptions) => {
      const adapter = adapters.find((a) => a.venue === leg.venue);
      if (!adapter) return { instructions: [], lookupTables: [], reason: "VENUE_NOT_CONFIGURED", detail: `no adapter for ${leg.venue}` };
      const rep = routerRepresentationForMint(leg.inputMint) ?? routerRepresentationForMint(leg.outputMint);
      const pools = rep ? poolsForRepresentation(rep.id, { venue: leg.venue }).filter((p) => p.address === leg.poolAddress) : [];
      const now = Date.now();
      // Re-quote the exact leg through the adapter so the build uses live state.
      const quote = await adapter.getQuote(
        { representationId: rep?.id ?? "", side: rep && leg.outputMint === rep.mint ? "buy" : "sell", amount: leg.amountIn, amountType: "input", inputMint: leg.inputMint, outputMint: leg.outputMint },
        { connection, pools, now, deadlineMs: 8_000 },
      );
      if (quote.unavailableReason) return { instructions: [], lookupTables: [], reason: quote.unavailableReason, detail: quote.unavailableDetail };
      if (quote.poolAddress !== leg.poolAddress) return { instructions: [], lookupTables: [], reason: "QUOTE_TERMS_MISMATCH", detail: "pool changed between quote and build" };
      return adapter.buildSwapInstructions(quote, { connection, pools, now, deadlineMs: 8_000 }, options);
    },
  });
  return api;
}

export async function POST(request: Request) {
  if (!flagEnabled("routerQuotes") || process.env.HENAR_ROUTER_UI !== "1")
    return NextResponse.json({ error: "router is disabled" }, { status: 404 });
  if (!flagEnabled("routerExecution"))
    return NextResponse.json({ error: "HENAR_ROUTER_EXECUTION is off", liveValidation: "LIVE_VALIDATION_PENDING" }, { status: 403 });
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc || !process.env.STOCKROOM_TREASURY_OWNER)
    return NextResponse.json({ error: "router execution is not configured" }, { status: 503 });
  let input: { mint: string; side: "buy" | "sell"; amount: string; owner: string };
  try {
    input = z.object({ mint: z.string(), side: z.enum(["buy", "sell"]), amount: z.string().max(30), owner: z.string() }).parse(await request.json());
    new PublicKey(input.owner);
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!verifyQuoteAccess(request, input.owner))
    return NextResponse.json({ error: "Verify your wallet to request a trade quote." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!consumeQuoteBudget(input.owner))
    return NextResponse.json({ error: "Quote limit reached. Please wait a minute." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  const rep = routerRepresentationForMint(input.mint);
  if (!rep) return NextResponse.json({ error: "unknown representation" }, { status: 404 });
  const r = await routerApi(rateLimitedConnection(rpc)).quoteAndBuild({ representationId: rep.id, side: input.side, amount: input.amount, owner: input.owner, wallet: input.owner });
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
