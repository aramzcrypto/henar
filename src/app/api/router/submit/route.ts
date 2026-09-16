/**
 * Protected submission for a signed Henar Router transaction (Task 17 wiring).
 *
 * The client signs; this route forwards the bytes through `submitWithPolicy`:
 * a Jito bundle endpoint when `HENAR_PRIVATE_SUBMIT=1` and
 * `JITO_BLOCK_ENGINE_URL` are set, with a plain RPC broadcast as the only
 * public fallback. The policy never fans one transaction out to more than one
 * public endpoint and stops retrying once the blockhash can no longer land.
 *
 * Returns 503 when no transport is configured, so the client can fall back
 * to its own RPC broadcast rather than treating the route as required. The
 * transaction is checked to be signed by exactly the wallet named in the
 * request before anything is forwarded; nothing here can sign.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { flagEnabled } from "@henar/router-core";
import { JitoSubmitter, RpcSubmitter, submitWithPolicy, type Submitter } from "@henar/tx-builder";
import { rateLimitedConnection } from "@/lib/rpc-limiter";
import { verifyQuoteAccess } from "@/lib/wallet-access-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!flagEnabled("routerQuotes") || process.env.HENAR_ROUTER_UI !== "1")
    return NextResponse.json({ error: "router is disabled" }, { status: 404 });
  if (!flagEnabled("routerExecution"))
    return NextResponse.json({ error: "HENAR_ROUTER_EXECUTION is off" }, { status: 403 });
  const rpc = process.env.SOLANA_RPC_URL;
  const jito = process.env.JITO_BLOCK_ENGINE_URL ?? null;
  const privateSubmit = flagEnabled("privateSubmit") && Boolean(jito);
  if (!rpc) return NextResponse.json({ error: "router execution is not configured" }, { status: 503 });
  if (!privateSubmit && process.env.HENAR_ROUTER_SUBMIT !== "1")
    return NextResponse.json({ error: "no protected transport configured; submit through your own RPC" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  let input: { transaction: string; owner: string; lastValidBlockHeight: number };
  try {
    input = z.object({ transaction: z.string().max(4_096), owner: z.string(), lastValidBlockHeight: z.number().int().positive() }).parse(await request.json());
    new PublicKey(input.owner);
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!verifyQuoteAccess(request, input.owner))
    return NextResponse.json({ error: "Verify your wallet to submit a trade." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(input.transaction, "base64"));
  } catch {
    return NextResponse.json({ error: "transaction is not a versioned transaction" }, { status: 400 });
  }
  // The wallet must be the fee payer and the only signer, and it must have signed.
  const payer = tx.message.staticAccountKeys[0]?.toBase58();
  if (payer !== input.owner || tx.message.header.numRequiredSignatures !== 1 || !tx.signatures[0]?.some((b) => b !== 0))
    return NextResponse.json({ error: "transaction is not signed by the owner alone" }, { status: 400 });

  const connection = rateLimitedConnection(rpc);
  const submitters: Submitter[] = [];
  if (privateSubmit && jito)
    submitters.push(
      new JitoSubmitter(async (body) => {
        const res = await fetch(`${jito.replace(/\/$/, "")}/api/v1/bundles`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        return { ok: res.ok, status: res.status, json };
      }),
    );
  submitters.push(new RpcSubmitter((t) => connection.sendRawTransaction(t.serialize(), { skipPreflight: false, maxRetries: 2 })));
  const outcome = await submitWithPolicy(tx, submitters, input.lastValidBlockHeight, {
    allowPublicFallback: true,
    maxAttemptsPerSubmitter: 2,
    retryDelayMs: 400,
    currentBlockHeight: () => connection.getBlockHeight("confirmed"),
  });
  const signature = outcome.accepted?.signature ?? Buffer.from(tx.signatures[0]).toString("base64");
  return NextResponse.json(
    { status: outcome.status, detail: outcome.detail, submitter: outcome.accepted?.submitter ?? null, kind: outcome.accepted?.kind ?? null, providerId: outcome.accepted?.providerId ?? null, signature: outcome.accepted ? signature : null, attempts: outcome.attempts.map((a) => ({ submitter: a.submitter, accepted: a.accepted, error: a.error })) },
    { status: outcome.status === "accepted" ? 200 : 502, headers: { "Cache-Control": "no-store" } },
  );
}
