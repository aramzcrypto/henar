/**
 * Task 11 live harness — LIVE_VALIDATION_PENDING until run with RPC.
 *
 * For every enabled registry pool: decode the raw account(s) with Henar's
 * state readers, quote through the native calculator, quote through the
 * venue adapter (official SDK path), and quote through Jupiter where a key
 * exists. Writes one `ComparisonRecord` per (pool, side, size) to
 * logs/router-validation.jsonl and exits non-zero if any record fails.
 *
 *   SOLANA_RPC_URL=… JUPITER_API_KEY=… npm run router:validate
 *
 * Without SOLANA_RPC_URL it exits non-zero and writes nothing: a fixture run
 * would not be validation.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  USDC_MINT,
  calculatorFor,
  compareQuotes,
  fromRaw,
  loadPoolRegistry,
  routerRepresentation,
  summarizeComparisons,
  type ComparisonRecord,
  type ComparisonSide,
  type NormalizedPoolState,
  type QuoteContext,
  type QuoteRequest,
  type VenueAdapter,
} from "@henar/router-core";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter, dbcStateReader, readDbcMarket } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter, dammV2StateReader } from "@henar/venue-meteora-damm-v2";

const SIZES_USDC = [10n, 100n, 1_000n, 10_000n].map((n) => n * 1_000_000n);
const LOG = process.env.HENAR_ROUTER_VALIDATION_LOG ?? "logs/router-validation.jsonl";

const adapters: Record<string, VenueAdapter> = {
  raydium: raydiumAdapter,
  meteora: meteoraAdapter,
  "meteora-dbc": meteoraDbcAdapter,
  "meteora-damm-v2": meteoraDammV2Adapter,
};

async function nativeSide(connection: Connection, poolType: string, poolAddress: string, request: QuoteRequest, currentPoint: bigint): Promise<ComparisonSide> {
  const calculator = calculatorFor(poolType as never);
  if (!calculator) return { amountOut: null, slot: null, error: "no calculator" };
  try {
    let state: NormalizedPoolState;
    const slot = await connection.getSlot("confirmed");
    if (poolType === "dbc") {
      const market = await readDbcMarket(connection, poolAddress);
      if (!market) return { amountOut: null, slot, error: "pool missing" };
      const [poolAcc, cfgAcc] = await connection.getMultipleAccountsInfo([new PublicKey(poolAddress), new PublicKey(market.configAddress)]);
      state = dbcStateReader.decode(poolAddress, poolAcc!, { [market.configAddress]: cfgAcc! });
    } else if (poolType === "damm_v2") {
      const acc = await connection.getAccountInfo(new PublicKey(poolAddress));
      if (!acc) return { amountOut: null, slot, error: "pool missing" };
      const rep = routerRepresentation(request.representationId);
      state = dammV2StateReader.withDecimals(rep?.decimals ?? 0, 6).decode(poolAddress, acc);
    } else {
      return { amountOut: null, slot, error: "LIVE_VALIDATION_PENDING: SDK-fetched state path not wired for this pool type in the harness yet" };
    }
    const r = calculator.quote(state, { inputMint: request.inputMint, outputMint: request.outputMint, amountIn: fromRaw(request.amount), currentPoint });
    return { amountOut: r.amountOut.toString(), slot, error: null };
  } catch (error) {
    return { amountOut: null, slot: null, error: (error as Error).message };
  }
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required; this harness does not run on fixtures.");
  const connection = new Connection(rpc, "confirmed");
  await mkdir("logs", { recursive: true });
  const registry = loadPoolRegistry();
  const records: ComparisonRecord[] = [];
  const now = Date.now();

  for (const pool of registry.pools.filter((p) => p.enabled)) {
    const rep = routerRepresentation(pool.representationId);
    const adapter = adapters[pool.venue];
    if (!rep || !adapter) continue;
    const ctx: QuoteContext = { connection, pools: [pool], now, deadlineMs: 10_000 };
    for (const size of SIZES_USDC) {
      for (const side of ["buy", "sell"] as const) {
        const request: QuoteRequest =
          side === "buy"
            ? { representationId: rep.id, side, amount: size.toString(), amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint }
            : { representationId: rep.id, side, amount: (10n ** BigInt(rep.decimals ?? 0)).toString(), amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT };
        const sdkQuote = await adapter.getQuote(request, ctx);
        const currentPoint = BigInt(Math.floor(now / 1000));
        const native = await nativeSide(connection, pool.poolType, pool.address, request, currentPoint);
        const jup = process.env.JUPITER_API_KEY ? await jupiterAdapter.getQuote(request, ctx) : null;
        const calculator = calculatorFor(pool.poolType);
        const record = compareQuotes({
          representationId: rep.id,
          venue: pool.venue,
          poolAddress: pool.address,
          side,
          amountIn: request.amount,
          calculatorStatus: calculator?.status ?? "LIVE_VALIDATION_PENDING",
          native,
          sdk: { amountOut: sdkQuote.unavailableReason ? null : sdkQuote.expectedAmountOut, slot: sdkQuote.slot, error: sdkQuote.unavailableReason ? `${sdkQuote.unavailableReason}: ${sdkQuote.unavailableDetail}` : null },
          jupiter: jup ? { amountOut: jup.unavailableReason ? null : jup.expectedAmountOut, slot: jup.slot, error: jup.unavailableReason } : null,
          live: true,
        });
        records.push(record);
        await appendFile(LOG, `${JSON.stringify(record)}\n`, "utf8");
        process.stdout.write(`${record.pass ? "PASS" : "FAIL"} ${pool.venue.padEnd(16)} ${rep.tokenSymbol.padEnd(8)} ${side} ${request.amount.padStart(14)} ${record.reason}\n`);
      }
    }
  }
  const summary = summarizeComparisons(records);
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.gatePassed) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
