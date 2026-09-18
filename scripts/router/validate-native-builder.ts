/**
 * Prove a native builder before its capability is trusted.
 *
 * `nativeBuild` now gates whether a venue may carry an executable leg, so
 * declaring it is a claim that has to be earned: instructions must construct,
 * enforce the guard's floor, and survive simulation against live state. This
 * script does that end to end for one venue and prints what it found.
 *
 * It signs nothing and sends nothing. The owner is a real mainnet holder of
 * the input token, discovered from the mint's largest accounts, because a
 * swap simulated from an account with no balance fails for a reason that says
 * nothing about the builder. Simulation runs with `sigVerify: false` and a
 * replaced blockhash, which is a read-only RPC call.
 *
 *   SOLANA_RPC_URL=... npm run router:validate:builder -- meteora
 */
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { loadPoolRegistry, USDC_MINT, type QuoteContext, type VenueAdapter, type VerifiedPool } from "@henar/router-core";
import { MeteoraAdapter } from "@henar/venue-meteora";
import { ByrealAdapter } from "@henar/venue-byreal";

const SIZES_USDC = [100, 1_000, 10_000];

function adapterFor(name: string): { adapter: VenueAdapter; venue: string; poolType: string } {
  if (name === "meteora") return { adapter: new MeteoraAdapter({ executionEnabled: true }), venue: "meteora", poolType: "dlmm" };
  if (name === "byreal") return { adapter: new ByrealAdapter(), venue: "byreal", poolType: "byreal_clmm" };
  throw new Error(`unknown venue ${name}; expected meteora or byreal`);
}

/** The SPL program that owns a mint: Token or Token-2022. */
async function tokenProgramOf(connection: Connection, mint: string): Promise<PublicKey> {
  const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
  if (!info) throw new Error(`mint ${mint} not found`);
  return info.owner;
}

/**
 * A real holder of `mint` whose *associated* account carries the balance.
 *
 * The largest token account is often not its owner's ATA, and the swap spends
 * the ATA — so picking by largest account alone yields "insufficient funds"
 * from an owner who genuinely holds the token. Each candidate's ATA is checked
 * instead, and the first with enough balance wins.
 */
async function holderOf(connection: Connection, mint: string, minimum: bigint): Promise<PublicKey | null> {
  const program = await tokenProgramOf(connection, mint);
  const largest = await connection.getTokenLargestAccounts(new PublicKey(mint));
  for (const account of largest.value.slice(0, 20)) {
    const parsed = await connection.getParsedAccountInfo(account.address);
    const data = parsed.value?.data;
    if (!data || typeof data !== "object" || !("parsed" in data)) continue;
    const owner = (data.parsed as { info?: { owner?: string } })?.info?.owner;
    /* Skip program-owned reserves: their authority is a PDA, which cannot be
       a fee payer and would fail simulation for the wrong reason. */
    if (!owner || !PublicKey.isOnCurve(new PublicKey(owner).toBytes())) continue;
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, program);
    const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
    if (balance && BigInt(balance.value.amount) >= minimum) return new PublicKey(owner);
  }
  return null;
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required.");
  const name = process.argv[2] ?? "meteora";
  const { adapter, venue, poolType } = adapterFor(name);
  const connection = new Connection(rpc, "confirmed");

  const registry = loadPoolRegistry();
  const pools = registry.pools.filter((p: VerifiedPool) => p.venue === venue && p.poolType === poolType && p.enabled);
  if (!pools.length) throw new Error(`no enabled ${venue} ${poolType} pools in the registry`);
  pools.sort((a: VerifiedPool, b: VerifiedPool) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));

  /* HENAR_SIM_OWNER pins the address to simulate as; without it one is
     discovered from the mint's largest accounts, which some public RPCs
     rate-limit. Either way it is only a public address: nothing is signed. */
  const pinned = process.env.HENAR_SIM_OWNER;
  const needed = BigInt(Math.max(...SIZES_USDC)) * 1_000_000n;
  const owner = pinned ? new PublicKey(pinned) : await holderOf(connection, USDC_MINT, needed);
  if (!owner) throw new Error("could not find a USDC holder to simulate as; set HENAR_SIM_OWNER");
  process.stdout.write(`${venue}: ${pools.length} enabled pools, simulating as ${owner.toBase58()}\n\n`);

  let attempted = 0;
  let built = 0;
  let floorEncoded = 0;
  let simulated = 0;

  for (const pool of pools.slice(0, 5)) {
    for (const sizeUsd of SIZES_USDC) {
      attempted += 1;
      const amount = (BigInt(sizeUsd) * 1_000_000n).toString();
      const request = {
        representationId: pool.representationId,
        side: "buy" as const,
        amount,
        amountType: "input" as const,
        inputMint: USDC_MINT,
        outputMint: pool.mint,
      };
      const ctx: QuoteContext = { connection, pools: [pool], now: Date.now(), deadlineMs: 20_000 };
      const quote = await adapter.getQuote(request, ctx);
      if (quote.unavailableReason) {
        process.stdout.write(`  ${pool.tokenSymbol.padEnd(8)} $${String(sizeUsd).padStart(6)}  quote: ${quote.unavailableReason} ${quote.unavailableDetail ?? ""}\n`);
        continue;
      }

      /* The floor the guard would approve. 50 bps below the quote is a normal
         slippage allowance; the point is that the instruction must carry it. */
      const minimumAmountOut = ((BigInt(quote.expectedAmountOut) * 9_950n) / 10_000n).toString();
      const result = await adapter.buildSwapInstructions(quote, ctx, { owner: owner.toBase58(), minimumAmountOut });
      if (result.reason || !result.instructions.length) {
        process.stdout.write(`  ${pool.tokenSymbol.padEnd(8)} $${String(sizeUsd).padStart(6)}  build: ${result.reason ?? "no instructions"} ${result.detail ?? ""}\n`);
        continue;
      }
      built += 1;

      /* The guard's floor has to be *in* the instruction, not merely passed to
         the SDK. swap2 encodes (amountIn, minOutAmount) as little-endian u64s,
         so both must appear verbatim in the data of the venue instruction.
         Without this the simulation would still pass while the transaction
         carried no slippage protection at all. */
      const venueIx = result.instructions.find((ix) => ix.programId.toBase58() === pool.programId)!;
      const le = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
      const carriesIn = venueIx.data.includes(le(BigInt(quote.amountIn)));
      const carriesMin = venueIx.data.includes(le(BigInt(minimumAmountOut)));
      if (!carriesIn || !carriesMin) {
        process.stdout.write(`  ${pool.tokenSymbol.padEnd(8)} $${String(sizeUsd).padStart(6)}  FLOOR NOT ENCODED (amountIn ${carriesIn}, minOut ${carriesMin})\n`);
        continue;
      }
      floorEncoded += 1;

      /* The planner creates the output ATA idempotently; reproduce that here
         so the simulation matches what would actually be sent. */
      /* The output mint's own program: these representations are Token-2022,
         and creating their ATA under the classic token program fails with
         IncorrectProgramId before the swap is ever reached. */
      const outProgram = await tokenProgramOf(connection, pool.mint);
      const outAta = getAssociatedTokenAddressSync(new PublicKey(pool.mint), owner, true, outProgram);
      const instructions = [
        createAssociatedTokenAccountIdempotentInstruction(owner, outAta, owner, new PublicKey(pool.mint), outProgram),
        ...result.instructions,
      ];
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
      const err = sim.value.err;
      if (!err) simulated += 1;
      const units = sim.value.unitsConsumed ?? 0;
      process.stdout.write(
        `  ${pool.tokenSymbol.padEnd(8)} $${String(sizeUsd).padStart(6)}  ${result.instructions.length} ix  minOut ${minimumAmountOut}  ${err ? `SIM FAIL ${JSON.stringify(err)}` : `sim ok (${units} CU)`}\n`,
      );
      if (err) for (const line of (sim.value.logs ?? []).slice(-6)) process.stdout.write(`      ${line}\n`);
    }
  }

  process.stdout.write(`\n${venue}: ${attempted} attempted, ${built} built, ${floorEncoded} carrying the guard floor, ${simulated} simulated clean\n`);
  if (!simulated || floorEncoded !== built) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
