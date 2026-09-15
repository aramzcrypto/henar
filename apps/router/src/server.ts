/**
 * Standalone router process (Tasks 19, 22, 23). Node `http` only — no
 * framework. Runs under `tsx` (see ARCHITECTURE §2.1 on aliases). Without
 * SOLANA_RPC_URL it starts with no stream and reports /ready=false; that is
 * the intended fail-closed state on this device.
 *
 *   npm run router:serve   (PORT, SOLANA_RPC_URL, HENAR_ROUTER_QUOTES, …)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";
import { flagEnabled, telemetrySinkFromEnv } from "@henar/router-core";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter, clmmStateReader } from "@henar/venue-raydium";
import { meteoraAdapter, dlmmStateReader } from "@henar/venue-meteora";
import { meteoraDbcAdapter, dbcStateReader } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter, dammV2StateReader } from "@henar/venue-meteora-damm-v2";
import { RouterApi } from "./api";
import { RouterHealth } from "./health";
import { FakeStreamSource, SolanaWebSocketStream } from "./stream";
import { StateWorker } from "./worker";

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

export async function startRouterServer(port = Number(process.env.PORT ?? 8787)) {
  const rpc = process.env.SOLANA_RPC_URL ?? null;
  const connection = rpc ? new Connection(rpc, "confirmed") : null;
  const stream = connection ? new SolanaWebSocketStream(connection, (a) => new PublicKey(a)) : new FakeStreamSource();
  const worker = new StateWorker({
    stream,
    load: async (addresses) => {
      if (!connection) return addresses.map((address) => ({ address, slot: 0, account: null }));
      const slot = await connection.getSlot("confirmed");
      const infos = await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed");
      return addresses.map((address, i) => ({ address, slot, account: infos[i] ?? null }));
    },
    readers: { clmm: clmmStateReader, dlmm: dlmmStateReader, dbc: dbcStateReader, damm_v2: dammV2StateReader },
  });
  const health = new RouterHealth(worker, { executionEnabled: () => flagEnabled("routerExecution") });
  const api = new RouterApi({
    adapters: [jupiterAdapter, raydiumAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter],
    connection,
    health,
    telemetry: telemetrySinkFromEnv(),
    currentSlot: async () => worker.readiness.currentSlot,
    treasuryOwner: process.env.STOCKROOM_TREASURY_OWNER ?? null,
  });
  if (connection) {
    try {
      await worker.start();
      health.recordStream(true, "connected");
    } catch (error) {
      health.recordStream(false, (error as Error).message);
    }
  } else health.recordStream(false, "no SOLANA_RPC_URL: LIVE_VALIDATION_PENDING");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, await health.report());
      if (req.method === "GET" && url.pathname === "/ready") {
        const r = await health.ready();
        return send(res, r.ready ? 200 : 503, r);
      }
      if (req.method === "GET" && url.pathname === "/metrics") {
        await health.report();
        return send(res, 200, health.metrics.render(), "text/plain; version=0.0.4");
      }
      if (req.method === "POST" && url.pathname === "/v1/quote") {
        const r = await api.quote(await readJson(req));
        return send(res, r.status, r.body);
      }
      if (req.method === "POST" && url.pathname === "/v1/build") {
        const r = await api.build(await readJson(req));
        return send(res, r.status, r.body);
      }
      if (req.method === "POST" && url.pathname === "/v1/submit") {
        const r = await api.submit();
        return send(res, r.status, r.body);
      }
      send(res, 404, { error: "not found" });
    } catch (error) {
      send(res, 500, { error: (error as Error).message });
    }
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return { server, worker, health, api, port };
}

if (process.argv[1]?.endsWith("server.ts")) {
  startRouterServer().then(({ port }) => process.stdout.write(`henar router listening on :${port}\n`)).catch((e) => {
    process.stderr.write(`${e}\n`);
    process.exitCode = 1;
  });
}
