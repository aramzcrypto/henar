/**
 * Meteora DBC + DAMM v2 discovery for the verified equity universe.
 *
 * RPC-gated: reads DBC virtual pools through the official SDK, keeps those
 * where at least one side is a verified registry mint, classifies their
 * lifecycle from program state, resolves graduated pools' DAMM v2
 * successors, and also sweeps DAMM v2 pools that pair a registry mint with
 * USDC directly. Writes:
 *   src/data/router/meteora-dbc-discovery.json
 *   src/data/router/meteora-damm-v2-discovery.json
 * which `router:pools:build` turns into registry records (eligibility is
 * decided there, from the pair).
 *
 * Without SOLANA_RPC_URL it exits non-zero and writes nothing: an empty
 * file would read as "no DBC markets exist", which is not known.
 */
import { writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "@henar/router-core";
import {
  classifyDbcLifecycle,
  dbcClient,
  dbcFacts,
  dbcSdk,
  readDbcMarket,
  resolveDammV2Successor,
} from "@henar/venue-meteora-dbc";
import { cpAmmClient } from "@henar/venue-meteora-damm-v2";
import { equityRegistry } from "../../src/lib/equities/registry";

const DBC_OUT = "src/data/router/meteora-dbc-discovery.json";
const DAMM_OUT = "src/data/router/meteora-damm-v2-discovery.json";

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required for DBC discovery.");
  const connection = new Connection(rpc, "confirmed");

  const verified = new Set<string>();
  for (const equity of equityRegistry)
    for (const r of equity.representations) if (r.providerStatus === "verified") verified.add(r.mint);

  const m = await dbcSdk();
  const client = await dbcClient(connection);
  process.stdout.write("Reading every DBC virtual pool…\n");
  const pools = await client.state.getPools();
  process.stdout.write(`  ${pools.length} DBC pools on chain\n`);

  const fetchedAt = new Date().toISOString();
  const dbcRows: unknown[] = [];
  const dammRows: unknown[] = [];
  for (const { publicKey, account } of pools) {
    const baseMint = account.poolState.baseMint.toBase58();
    const config = await client.state.getPoolConfig(account.poolState.config);
    if (!config) continue;
    const quoteMint = config.quoteMint.toBase58();
    if (!verified.has(baseMint) && !verified.has(quoteMint)) continue;

    const market = await readDbcMarket(connection, publicKey.toBase58());
    if (!market) continue;
    const facts = dbcFacts(market.pool, market.config);
    const lifecycle = classifyDbcLifecycle(facts, market.currentPoint);
    let successor = { status: "NOT_APPLICABLE" as const, poolAddress: null as string | null };
    if (lifecycle.state === "GRADUATED") {
      const resolved = await resolveDammV2Successor(connection, market);
      successor = { status: resolved.status, poolAddress: resolved.poolAddress } as typeof successor;
      if (resolved.status === "CONFIRMED" && resolved.poolAddress)
        dammRows.push({
          poolAddress: resolved.poolAddress,
          tokenAMint: baseMint,
          tokenBMint: quoteMint,
          feeBps: Number(market.config.migratedPoolFeeBps) || null,
          predecessorDbcPool: publicKey.toBase58(),
          fetchedAt,
        });
    }
    let baseFeeBps: number | null = null;
    try {
      baseFeeBps = m.feeNumeratorToBps(market.config.poolFees.baseFee.cliffFeeNumerator);
    } catch {
      baseFeeBps = null;
    }
    dbcRows.push({
      poolAddress: publicKey.toBase58(),
      configAddress: market.configAddress,
      baseMint,
      quoteMint,
      lifecycle: lifecycle.state,
      lifecycleSlot: market.slot,
      successorStatus: successor.status,
      successorPoolAddress: successor.poolAddress,
      baseFeeBps,
      fetchedAt,
    });
  }

  // Direct DAMM v2 pools pairing a registry mint with USDC (not via DBC).
  process.stdout.write("Sweeping DAMM v2 pools by USDC…\n");
  const cp = await cpAmmClient(connection);
  const seen = new Set(dammRows.map((r) => (r as { poolAddress: string }).poolAddress));
  const usdcPools = await cp.fetchPoolStatesByTokenMint(new PublicKey(USDC_MINT));
  for (const { publicKey, account } of usdcPools) {
    const a = account.tokenAMint.toBase58();
    const b = account.tokenBMint.toBase58();
    const other = a === USDC_MINT ? b : a;
    if (!verified.has(other) || seen.has(publicKey.toBase58())) continue;
    dammRows.push({ poolAddress: publicKey.toBase58(), tokenAMint: a, tokenBMint: b, feeBps: null, predecessorDbcPool: null, fetchedAt });
  }

  await writeFile(DBC_OUT, `${JSON.stringify(dbcRows, null, 2)}\n`, "utf8");
  await writeFile(DAMM_OUT, `${JSON.stringify(dammRows, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${DBC_OUT} (${dbcRows.length}) and ${DAMM_OUT} (${dammRows.length}).\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
