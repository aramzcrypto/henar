/**
 * Executing a Henar Router route from the trade ticket.
 *
 * The quote list ranks every source by net user output, and execution has to
 * follow that ranking rather than a fixed provider. Two builders exist and
 * only two: a Henar-held route (a single native pool or a split across
 * several) is built here through /api/router/build under the Execution Guard,
 * and a Jupiter win is built through /api/market. Quote-only sources are
 * ranked for information and can never be executed, so they are never chosen.
 *
 * Until this existed, the ticket always built through /api/market, so a Henar
 * route could be shown as the best quote and then not be the route the user
 * actually took.
 */
import { VersionedTransaction, type AddressLookupTableAccount, type Connection } from "@solana/web3.js";
import { validateRouterTransaction } from "@/lib/router-transaction";

export type RouterPlanSummary = Parameters<typeof validateRouterTransaction>[1];

export type RouterBuild = {
  transaction: string;
  plan: RouterPlanSummary;
  quote?: unknown;
  lastValidBlockHeight?: number;
  error?: string;
  reason?: string;
};

export type RouterTradeTerms = {
  owner: string;
  inputMint: string;
  outputMint: string;
  amount: bigint;
};

/** Ask the router for a fresh quote and an unsigned transaction. */
export async function buildRouterTrade(
  input: { mint: string; side: "buy" | "sell"; amount: bigint; owner: string; authorization: string },
  signal?: AbortSignal,
): Promise<RouterBuild> {
  const response = await fetch("/api/router/build", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: input.authorization },
    body: JSON.stringify({ mint: input.mint, side: input.side, amount: input.amount.toString(), owner: input.owner }),
    signal,
  });
  const body = (await response.json()) as RouterBuild;
  if (!response.ok)
    throw new Error(body.error ? `${body.error}${body.reason ? ` (${body.reason})` : ""}` : `Router build failed (HTTP ${response.status})`);
  return body;
}

/**
 * Everything that must hold before a wallet is asked to sign: the transaction
 * matches the plan and the user's own terms, it simulates, and the plan has
 * not expired. Any failure throws with "Nothing was signed" so the message
 * itself tells the user where they stand.
 */
export async function prepareRouterTransaction(
  build: RouterBuild,
  terms: RouterTradeTerms,
  connection: Connection,
): Promise<VersionedTransaction> {
  const transaction = VersionedTransaction.deserialize(Buffer.from(build.transaction, "base64"));
  const tables: AddressLookupTableAccount[] = await Promise.all(
    transaction.message.addressTableLookups.map(async (lookup) => {
      const result = await connection.getAddressLookupTable(lookup.accountKey);
      if (!result.value) throw new Error("Routing table unavailable. Nothing was signed.");
      return result.value;
    }),
  );
  validateRouterTransaction(transaction, build.plan, terms, tables);
  const simulation = await connection.simulateTransaction(transaction, { sigVerify: false });
  if (simulation.value.err)
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}. Nothing was signed.`);
  if (Date.now() >= Date.parse(build.plan.expiresAt))
    throw new Error("Quote expired before signing. Nothing was signed.");
  return transaction;
}
