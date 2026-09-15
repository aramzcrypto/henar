/**
 * Refresh lifecycle + successor for every DBC record in `pools.json`.
 *
 * Uses the same `refreshDbcLifecycle` the adapter and monitor use — one
 * state code path. Updates only the `dbc` block and the routing flags of
 * DBC records; never removes a record (the DBC identity is history once it
 * graduates) and never touches other venues.
 *
 * RPC-gated; exits non-zero without SOLANA_RPC_URL.
 */
import { readFile, writeFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import type { VerifiedPool } from "@henar/router-core";
import { refreshDbcLifecycle } from "@henar/venue-meteora-dbc";

const FILE = "src/data/router/pools.json";

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required to refresh DBC lifecycle.");
  const connection = new Connection(rpc, "confirmed");
  const pools = JSON.parse(await readFile(FILE, "utf8")) as VerifiedPool[];
  let changed = 0;
  for (const pool of pools) {
    if (pool.poolType !== "dbc" || !pool.dbc) continue;
    const snap = await refreshDbcLifecycle(connection, pool.address, {
      successorHint: pool.dbc.successorPoolAddress,
    });
    if (!snap) {
      process.stdout.write(`  ${pool.address}: pool account missing; left unchanged\n`);
      continue;
    }
    const before = JSON.stringify(pool.dbc);
    pool.dbc = {
      configAddress: snap.configAddress,
      lifecycle: snap.lifecycle,
      lifecycleCheckedAt: snap.checkedAt,
      lifecycleSlot: snap.slot,
      successorStatus: snap.successorStatus,
      successorPoolAddress: snap.successorPoolAddress,
      successorConfirmedAt:
        snap.successorStatus === "CONFIRMED"
          ? (pool.dbc.successorConfirmedAt ?? snap.checkedAt)
          : null,
    };
    const routable = pool.eligibility === "ROUTER_ELIGIBLE" && snap.lifecycle === "BONDING";
    pool.enabled = routable;
    pool.disabledReason = routable
      ? null
      : pool.eligibility !== "ROUTER_ELIGIBLE"
        ? "STOCK_PAIRED_INFRASTRUCTURE: not a USDC↔equity route"
        : `DBC lifecycle ${snap.lifecycle}`;
    if (JSON.stringify(pool.dbc) !== before) changed += 1;
    process.stdout.write(
      `  ${pool.tokenSymbol} ${pool.address}: ${snap.lifecycle} (${snap.detail}) successor=${snap.successorStatus}${snap.successorPoolAddress ? ` ${snap.successorPoolAddress}` : ""}\n`,
    );
  }
  await writeFile(FILE, `${JSON.stringify(pools, null, 2)}\n`, "utf8");
  process.stdout.write(`Updated ${changed} DBC records in ${FILE}.\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
