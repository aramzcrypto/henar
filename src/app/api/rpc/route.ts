import { boundedJson } from "@/lib/request-body";
import { rpcRequest } from "@/lib/rpc-policy";
import { NextResponse } from "next/server";
import { assertApplicationRelay } from "@/lib/relay-policy";
export async function POST(req: Request) {
  if (!process.env.SOLANA_RPC_URL)
    return NextResponse.json(
      {
        error: { code: -32000, message: "Mainnet RPC is not configured." },
        jsonrpc: "2.0",
        id: 1,
      },
      { status: 503 },
    );
  let body;
  try {
    body = rpcRequest(await boundedJson(req));
    if (body.method === "sendTransaction")
      assertApplicationRelay(String(body.params[0]), process.env.STOCKROOM_PROGRAM_ID);
  } catch {
    return new Response("Invalid RPC request", { status: 400 });
  }
  try {
    const res = await fetch(process.env.SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: { code: -32000, message: "RPC unavailable" },
        jsonrpc: "2.0",
        id: 1,
      },
      { status: 503 },
    );
  }
}
