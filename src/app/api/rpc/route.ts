import { NextResponse } from "next/server";
const allowed = new Set([
  "getLatestBlockhash",
  "getBlockHeight",
  "getSignatureStatuses",
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  "getFeeForMessage",
  "simulateTransaction",
  "sendTransaction",
  "getVersion",
]);
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
  const raw = await req.text();
  if (raw.length > 20000)
    return new Response("Request too large", { status: 413 });
  try {
    const body = JSON.parse(raw);
    if (!allowed.has(body.method) || Array.isArray(body))
      return new Response("Method unavailable", { status: 400 });
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
