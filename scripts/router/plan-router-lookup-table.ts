/**
 * Plan a Henar-owned address lookup table for the router, and prove it works
 * before anything is created on chain.
 *
 * The two-leg cap exists because three legs do not fit in a 1232-byte packet:
 * measured at 1263 bytes, with seven of eight routes failing to serialize at
 * all. That cap is the whole remaining loss at size — the benchmark puts the
 * native engine at -1 bps on $100 and -28 bps on $50,000, and Jupiter uses a
 * mean of 3.27 venues at that size.
 *
 * A lookup table replaces a 32-byte account key with a 1-byte index, so the
 * question is simply how many of a route's accounts recur often enough to be
 * worth a table, and whether moving them brings three legs under the limit.
 *
 * This answers it by compiling each route twice — once as today, once against
 * a table constructed in memory — and comparing the serialized sizes. The
 * table is never created and nothing is signed or sent: `AddressLookupTableAccount`
 * is a plain object, and the message compiler does not consult the chain. So
 * the saving is measured exactly, on real routes, at zero risk.
 *
 * It then prints the account set the real table would hold.
 */
import { writeFile } from "node:fs/promises";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DEFAULT_SPLIT_OPTIONS, USDC_MINT, loadPoolRegistry, quoteRepresentation, type QuoteContext, type VenueAdapter, type VerifiedPool } from "@henar/router-core";
import { RaydiumAdapter, RaydiumCpmmAdapter } from "@henar/venue-raydium";
import { MeteoraAdapter } from "@henar/venue-meteora";
import { OrcaAdapter } from "@henar/venue-orca";
import { ByrealAdapter } from "@henar/venue-byreal";

const MAX_TRANSACTION_BYTES = 1232;
/** A lookup table holds at most 256 addresses. */
const MAX_TABLE_ADDRESSES = 256;
const SIZES = [10_000, 25_000, 50_000];
const OUTPUT = "docs/router/LOOKUP_TABLE_PLAN.json";

type Row = {
  ticker: string;
  sizeUsd: number;
  legs: number;
  venues: string[];
  bytesToday: number | null;
  bytesWithTable: number | null;
  fitsToday: boolean;
  fitsWithTable: boolean;
  accountsMoved: number;
};

/** Every account a route touches that a table could carry. */
function tableCandidates(instructions: TransactionInstruction[], owner: PublicKey): PublicKey[] {
  const keys = new Map<string, PublicKey>();
  for (const ix of instructions) {
    /* Program ids can live in a table too, but the fee payer and any signer
       must stay in the static keys, so they are never candidates. */
    keys.set(ix.programId.toBase58(), ix.programId);
    for (const k of ix.keys) {
      if (k.isSigner || k.pubkey.equals(owner)) continue;
      keys.set(k.pubkey.toBase58(), k.pubkey);
    }
  }
  return [...keys.values()];
}

function sizeOf(instructions: TransactionInstruction[], owner: PublicKey, blockhash: string, tables: AddressLookupTableAccount[]): number | null {
  try {
    const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message(tables);
    return new VersionedTransaction(message).serialize().length;
  } catch {
    return null; // Over the limit: serialization refuses rather than truncating.
  }
}

async function tokenProgramOf(connection: Connection, mint: string) {
  const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
  if (!info) throw new Error(`mint ${mint} not found`);
  return info.owner;
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required; this never runs on fixtures.");
  const owner = new PublicKey(process.env.HENAR_SIM_OWNER ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
  const connection = new Connection(rpc, "confirmed");
  const registry = loadPoolRegistry();

  const adapters: VenueAdapter[] = [
    new RaydiumAdapter({ executionEnabled: true }),
    new RaydiumCpmmAdapter({ executionEnabled: true }),
    new OrcaAdapter({ executionEnabled: true }),
    new MeteoraAdapter({ executionEnabled: true }),
    new ByrealAdapter({ executionEnabled: true }),
  ];

  const byRep = new Map<string, VerifiedPool[]>();
  for (const p of registry.pools) {
    if (!p.enabled || p.eligibility !== "ROUTER_ELIGIBLE") continue;
    if (!["raydium", "orca", "meteora", "byreal"].includes(p.venue)) continue;
    byRep.set(p.representationId, [...(byRep.get(p.representationId) ?? []), p]);
  }
  /* Three legs need three curves, so only representations with at least three
     enabled pools can exercise the cap this is meant to lift. */
  const candidates = [...byRep.entries()]
    .filter(([, pools]) => pools.length >= 3)
    .sort((a, b) => b[1].reduce((s, p) => s + (p.tvlUsd ?? 0), 0) - a[1].reduce((s, p) => s + (p.tvlUsd ?? 0), 0))
    .slice(0, 8);

  process.stdout.write(`${candidates.length} representations with three or more native pools\n\n`);

  const rows: Row[] = [];
  /* The union across routes is what the real table would hold: an account is
     only worth a slot if more than one route uses it. */
  const frequency = new Map<string, { key: PublicKey; routes: number }>();

  for (const [representationId, pools] of candidates) {
    const ticker = pools[0].tokenSymbol;
    const mint = pools[0].mint;
    const outProgram = await tokenProgramOf(connection, mint);
    for (const sizeUsd of SIZES) {
      const amount = (BigInt(sizeUsd) * 1_000_000n).toString();
      const request = { representationId, side: "buy" as const, amount, amountType: "input" as const, inputMint: USDC_MINT, outputMint: mint };
      /* Ask for three legs explicitly. The shipped default is two precisely
         because three does not fit; this measures what lifting it would cost. */
      const result = await quoteRepresentation(request, {
        adapters, enabled: true, splitRouting: true, pathRouting: false,
        poolsOverride: pools, connection, deadlineMs: 30_000,
        splitOptions: { ...DEFAULT_SPLIT_OPTIONS, maxLegs: 3 },
      }).catch(() => null);
      const route = result?.route;
      if (!route || route.legs.length < 3) continue;

      const instructions: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, outProgram), owner, new PublicKey(mint), outProgram),
      ];
      let ok = true;
      for (const leg of route.legs) {
        const adapter = adapters.find((a) => a.venue === leg.venue);
        const pool = pools.find((p) => p.address === leg.poolAddress);
        if (!adapter || !pool) { ok = false; break; }
        const ctx: QuoteContext = { connection, pools: [pool], now: Date.now(), deadlineMs: 30_000 };
        const minimumAmountOut = ((BigInt(leg.expectedAmountOut) * 9_900n) / 10_000n).toString();
        const built = await adapter.buildSwapInstructions(leg, ctx, { owner: owner.toBase58(), minimumAmountOut });
        if (built.reason || !built.instructions.length) { ok = false; break; }
        instructions.push(...built.instructions);
      }
      if (!ok) continue;

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const candidatesForTable = tableCandidates(instructions, owner);
      /* Constructed in memory. The compiler does not check the chain, so this
         measures the exact saving a real table would give. */
      const synthetic = new AddressLookupTableAccount({
        key: new PublicKey("11111111111111111111111111111112"),
        state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: owner, addresses: candidatesForTable },
      });
      const bytesToday = sizeOf(instructions, owner, blockhash, []);
      const bytesWithTable = sizeOf(instructions, owner, blockhash, [synthetic]);

      for (const key of candidatesForTable) {
        const seen = frequency.get(key.toBase58()) ?? { key, routes: 0 };
        seen.routes += 1;
        frequency.set(key.toBase58(), seen);
      }

      const row: Row = {
        ticker, sizeUsd, legs: route.legs.length, venues: route.legs.map((l) => l.venue),
        bytesToday, bytesWithTable,
        fitsToday: bytesToday !== null && bytesToday <= MAX_TRANSACTION_BYTES,
        fitsWithTable: bytesWithTable !== null && bytesWithTable <= MAX_TRANSACTION_BYTES,
        accountsMoved: candidatesForTable.length,
      };
      rows.push(row);
      process.stdout.write(
        `  ${ticker.padEnd(9)} $${String(sizeUsd).padStart(6)}  ${row.venues.join("+").padEnd(26)} today ${String(bytesToday ?? "over").padStart(5)}  with table ${String(bytesWithTable ?? "over").padStart(5)}  ${row.fitsWithTable ? "FITS" : "still over"}\n`,
      );
    }
  }

  /* Only accounts more than one route touches earn a slot; a pool used once
     costs a slot and saves 31 bytes on a single trade. */
  const shared = [...frequency.values()].filter((f) => f.routes > 1).sort((a, b) => b.routes - a.routes);
  const table = shared.slice(0, MAX_TABLE_ADDRESSES).map((f) => f.key.toBase58());

  await writeFile(OUTPUT, `${JSON.stringify({ plannedAt: new Date().toISOString(), limit: MAX_TRANSACTION_BYTES, rows, tableAddresses: table, sharedAccounts: shared.length }, null, 2)}\n`, "utf8");

  const three = rows.filter((r) => r.legs >= 3);
  process.stdout.write(`\n${three.length} three-leg routes measured\n`);
  process.stdout.write(`  fit today:      ${three.filter((r) => r.fitsToday).length}\n`);
  process.stdout.write(`  fit with table: ${three.filter((r) => r.fitsWithTable).length}\n`);
  process.stdout.write(`  ${shared.length} accounts are touched by more than one route; the table would hold ${table.length}\n`);
  process.stdout.write(`Wrote ${OUTPUT}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
