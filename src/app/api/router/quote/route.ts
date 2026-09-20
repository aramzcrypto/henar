/**
 * Henar Router comparison quote (Task 24) — behind HENAR_ROUTER_QUOTES and
 * HENAR_ROUTER_UI. Read-only: returns the router's guarded quote for display
 * next to the production Jupiter path. Never builds or submits; the live
 * Trade path is unchanged and remains the only execution route.
 */
import { NextResponse } from "next/server";
import { flagEnabled, routerRepresentationForMint, telemetrySinkFromEnv } from "@henar/router-core";
import { RouterApi } from "@henar/router-app";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { z } from "zod";
import { boundedJson } from "@/lib/request-body";
import { consumePublicQuoteBudget } from "@/lib/equities/rate-limit";
import { pythGuardInputFor } from "@/lib/pyth/guard-input";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter, raydiumCpmmAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";
import { byrealAdapter } from "@henar/venue-byreal";
import { rfqAdapter } from "@henar/venue-rfq";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const schema = z.object({
  mint: z.string().min(32).max(44),
  side: z.enum(["buy", "sell"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/).max(30),
  /* A caller may ask for a longer venue deadline for diagnosis. Clamped, and
     never the default: production times out Raydium and Orca at exactly
     6000ms on calls that take under two seconds locally, and without being
     able to let one run longer there is no way to learn what they actually
     cost in that environment. */
  deadlineMs: z.coerce.number().int().min(0).max(25_000).optional(),
});

let api: RouterApi | null = null;
function routerApi() {
  if (!api) {
    const rpc = process.env.SOLANA_RPC_URL;
    api = new RouterApi({
      adapters: [jupiterAdapter, raydiumAdapter, raydiumCpmmAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter, byrealAdapter, rfqAdapter],
      connection: rpc ? rateLimitedConnection(rpc) : null,
      health: null,
      telemetry: telemetrySinkFromEnv(),
      pyth: pythGuardInputFor,
    });
  }
  return api;
}

export async function POST(request: Request) {
  if (!flagEnabled("routerQuotes") || process.env.HENAR_ROUTER_UI !== "1")
    return NextResponse.json({ error: "router comparison is disabled" }, { status: 404 });
  /* One quote here fans out to ten venue adapters, several of which do bulk
     RPC reads, and the caller may ask for a deadline of up to 25 seconds. Its
     three sibling quote routes are budgeted; this one was not, so an
     unauthenticated caller could hold a lambda and the RPC quota open at
     will. The product refreshes a ticket about five times a minute against a
     budget of sixty, so nothing the interface does comes close to it. */
  if (!consumePublicQuoteBudget(request))
    return NextResponse.json(
      { error: "Quote limit reached. Please wait a minute." },
      { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  /* Validated rather than cast, the way the sibling build route does it:
     `side` and `amount` reached the router as whatever was sent. */
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await boundedJson(request));
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const rep = routerRepresentationForMint(body.mint);
  if (!rep) return NextResponse.json({ error: "unknown representation" }, { status: 404 });
  const deadlineMs = body.deadlineMs || undefined;
  const r = await routerApi().quote({ representationId: rep.id, side: body.side, amount: body.amount, deadlineMs });
  return NextResponse.json(r.body, { status: r.status });
}
