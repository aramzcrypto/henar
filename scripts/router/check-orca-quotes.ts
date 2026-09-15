/**
 * Item 6 check: can the existing Orca adapter consume the registry entries
 * that venue-native discovery just enabled? Enabling a pool in JSON proves
 * nothing until the adapter finds it, decodes its state and returns a number.
 * Read-only.
 */
import { Connection } from "@solana/web3.js";
import { loadPoolRegistry, USDC_MINT } from "@henar/router-core";
import { orcaAdapter } from "@henar/venue-orca";

async function main() {
const rpc = process.env.SOLANA_RPC_URL;
const registry = loadPoolRegistry();
const orca = registry.pools.filter((p) => p.venue === "orca" && p.enabled);
console.log("caps:", JSON.stringify(orcaAdapter.capabilities()));
console.log("enabled orca pools:", orca.length);
const connection = rpc ? new Connection(rpc, "confirmed") : null;
for (const prov of ["backpack", "xstocks"]) {
  const pool = orca.find((p) => p.provider === prov);
  if (!pool) { console.log(prov, "no enabled pool"); continue; }
  const pools = registry.pools.filter((p) => p.representationId === pool.representationId && p.enabled);
  const req = {
    representationId: pool.representationId,
    side: "buy" as const,
    amount: "100000000",
    amountType: "input" as const,
    inputMint: USDC_MINT,
    outputMint: pool.mint,
  };
  try {
    const q = await orcaAdapter.getQuote(req, { connection, pools, now: Date.now(), deadlineMs: Date.now() + 20000 });
    console.log(prov.padEnd(9), pool.tokenSymbol.padEnd(7), "out=" + (q.expectedAmountOut ?? "null"), "path=" + q.executionPath, "reason=" + (q.unavailableReason ?? "none"), "slot=" + (q.slot ?? "-"));
  } catch (e) { console.log(prov, "ERR", e instanceof Error ? e.message.slice(0, 90) : e); }
}
}

void main();
