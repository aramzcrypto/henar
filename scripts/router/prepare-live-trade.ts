/**
 * Prepare one real mainnet trade, and reconcile it afterwards.
 *
 * This runs the production path — the same RouterApi, adapters, guard,
 * planner, builder, lookup tables and simulation gate the app uses — and stops
 * at the signature. It never signs and never submits. The output is an
 * unsigned v0 transaction plus the plan to check it against.
 *
 *   npm run router:trade:prepare -- <ownerWallet> <mint> <usdcAmount>
 *   npm run router:trade:reconcile -- <signature> <ownerWallet> <mint>
 *
 * Reconciliation reads the confirmed transaction's own pre/post token
 * balances, so the realized output is what the chain recorded rather than
 * anything this process believed at quote time.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { USDC_MINT, poolByAddress, telemetrySinkFromEnv, type BuildOptions, type PlannedLeg } from "@henar/router-core";
import { RouterApi } from "@henar/router-app";
import { RpcSimulator } from "@henar/tx-builder";
import { AddressLookupTableAccount } from "@solana/web3.js";
import { jupiterAdapter } from "@henar/venue-jupiter";
import { raydiumAdapter, raydiumCpmmAdapter } from "@henar/venue-raydium";
import { meteoraAdapter } from "@henar/venue-meteora";
import { meteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { meteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { openOceanAdapter } from "@henar/venue-openocean";
import { orcaAdapter } from "@henar/venue-orca";
import { byrealAdapter } from "@henar/venue-byreal";
import { rfqAdapter } from "@henar/venue-rfq";
import { routerRepresentationForMint } from "@henar/router-core";

const adapters = [jupiterAdapter, raydiumAdapter, raydiumCpmmAdapter, meteoraAdapter, meteoraDbcAdapter, meteoraDammV2Adapter, openOceanAdapter, orcaAdapter, byrealAdapter, rfqAdapter];

function api(connection: Connection, treasuryOwner: string) {
  return new RouterApi({
    adapters,
    connection,
    health: null,
    telemetry: telemetrySinkFromEnv(),
    treasuryOwner,
    blockhash: {
      async latest() {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        return { blockhash, lastValidBlockHeight, source: "rpc" as const };
      },
    },
    lookupTables: {
      async resolve(addresses: string[]) {
        const fetched = await Promise.all(
          addresses.map((a) => connection.getAddressLookupTable(new PublicKey(a)).then((r) => r.value, () => null)),
        );
        return fetched.filter((t): t is AddressLookupTableAccount => Boolean(t?.isActive()));
      },
    },
    legBuilder: async (leg: PlannedLeg, options: BuildOptions) => {
      const pool = poolByAddress(leg.poolAddress);
      const adapter =
        (pool && adapters.find((a) => a.venue === leg.venue && a.capabilities().poolTypes.includes(pool.poolType))) ??
        adapters.find((a) => a.venue === leg.venue);
      if (!adapter) return { instructions: [], lookupTables: [], reason: "VENUE_NOT_CONFIGURED" as const, detail: `no adapter for ${leg.venue}` };
      if (!pool || !pool.enabled) return { instructions: [], lookupTables: [], reason: "NO_VERIFIED_POOL" as const, detail: `leg pool ${leg.poolAddress} is not enabled` };
      const ctx = { connection, pools: [pool], now: Date.now(), deadlineMs: 20_000 };
      const quote = await adapter.getQuote(
        { representationId: pool.representationId, side: leg.outputMint === USDC_MINT ? "sell" : "buy", amount: leg.amountIn, amountType: "input", inputMint: leg.inputMint, outputMint: leg.outputMint },
        ctx,
      );
      if (quote.unavailableReason) return { instructions: [], lookupTables: [], reason: quote.unavailableReason, detail: quote.unavailableDetail };
      return adapter.buildSwapInstructions(quote, ctx, options);
    },
    simulator: new RpcSimulator(connection),
  });
}

async function prepare(connection: Connection, treasuryOwner: string, owner: string, mint: string, usdc: number) {
  const rep = routerRepresentationForMint(mint);
  if (!rep) throw new Error(`no router representation for mint ${mint}`);
  const amount = (BigInt(Math.round(usdc * 1_000_000))).toString();
  process.stdout.write(`Preparing ${rep.tokenSymbol}: ${usdc} USDC from ${owner}\n\n`);

  const r = await api(connection, treasuryOwner).quoteAndBuild({ representationId: rep.id, side: "buy", amount, owner, wallet: owner });
  if (r.status !== 200) {
    process.stdout.write(`Refused (${r.status}): ${JSON.stringify(r.body, null, 2).slice(0, 1200)}\n`);
    process.exitCode = 1;
    return;
  }
  const body = r.body as {
    plan: { planId: string; kind: string; legs: { venue: string; poolAddress: string; amountIn: string; expectedAmountOut: string; minimumAmountOut: string }[]; totals: { expectedAmountOut: string; minimumNetUserOutput: string }; henarFee: { amount: string; mint: string }; expiresAt: string };
    transaction: string;
    simulation: unknown;
    serializedBytes?: number;
    lookupTables?: string[];
    blockhash: string;
    lastValidBlockHeight: number;
  };
  const p = body.plan;
  process.stdout.write(`plan ${p.planId}  kind=${p.kind}  expires ${p.expiresAt}\n`);
  for (const leg of p.legs)
    process.stdout.write(`  leg ${leg.venue.padEnd(9)} pool ${leg.poolAddress.slice(0, 8)}  in ${leg.amountIn}  expect ${leg.expectedAmountOut}  floor ${leg.minimumAmountOut}\n`);
  process.stdout.write(`  expected out ${p.totals.expectedAmountOut}  guaranteed minimum ${p.totals.minimumNetUserOutput}\n`);
  process.stdout.write(`  henar fee ${p.henarFee.amount} of ${p.henarFee.mint.slice(0, 6)}\n`);
  process.stdout.write(`  ${body.serializedBytes ?? "?"} bytes, ${body.lookupTables?.length ?? 0} lookup table(s)\n`);
  process.stdout.write(`  simulation: ${JSON.stringify(body.simulation).slice(0, 300)}\n`);
  process.stdout.write(`  valid until block height ${body.lastValidBlockHeight}\n\n`);
  process.stdout.write(`UNSIGNED TRANSACTION (base64) — nothing has been signed or sent:\n${body.transaction}\n`);
}

async function reconcile(connection: Connection, signature: string, owner: string, mint: string) {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error(`transaction ${signature} not found or not yet confirmed`);
  if (tx.meta?.err) {
    process.stdout.write(`Transaction failed on chain: ${JSON.stringify(tx.meta.err)}\n`);
    process.exitCode = 1;
    return;
  }
  /* Deltas come from the transaction's own recorded balances, which is the
     only account of what actually happened that does not depend on this
     process having been right. */
  const delta = (m: string) => {
    const pre = (tx.meta?.preTokenBalances ?? []).filter((b) => b.mint === m && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const post = (tx.meta?.postTokenBalances ?? []).filter((b) => b.mint === m && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    return post - pre;
  };
  const usdcDelta = delta(USDC_MINT);
  const repDelta = delta(mint);
  process.stdout.write(`slot ${tx.slot}, fee ${tx.meta?.fee} lamports, ${tx.meta?.computeUnitsConsumed ?? "?"} CU\n`);
  process.stdout.write(`USDC delta ${usdcDelta}\n`);
  process.stdout.write(`${mint.slice(0, 8)} delta ${repDelta}\n`);
  const quoted = process.env.HENAR_QUOTED_OUT;
  if (quoted) {
    const q = BigInt(quoted);
    const diff = repDelta - q;
    const bps = q > 0n ? Number((diff * 10_000n) / q) : 0;
    process.stdout.write(`quoted ${q}, realized ${repDelta}, difference ${diff} (${bps} bps)\n`);
  } else {
    process.stdout.write(`set HENAR_QUOTED_OUT to the plan's expected output to compare realized against quote\n`);
  }
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required.");
  const treasuryOwner = process.env.STOCKROOM_TREASURY_OWNER;
  if (!treasuryOwner) throw new Error("STOCKROOM_TREASURY_OWNER is required: it is the Henar fee destination the plan pays into.");
  const connection = new Connection(rpc, "confirmed");
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "reconcile") {
    const [signature, owner, mint] = rest;
    if (!signature || !owner || !mint) throw new Error("usage: reconcile <signature> <owner> <mint>");
    await reconcile(connection, signature, owner, mint);
    return;
  }
  const [owner, mint, usdc] = mode === "prepare" ? rest : [mode, ...rest];
  if (!owner || !mint || !usdc) throw new Error("usage: prepare <owner> <mint> <usdcAmount>");
  await prepare(connection, treasuryOwner, owner, mint, Number(usdc));
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
