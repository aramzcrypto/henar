/**
 * Client-side check of a Henar Router transaction before the wallet sees it.
 *
 * Mirrors the intent of `validateMarketTransaction` for the router path:
 * the wallet is the only signer and the payer, every program is on the
 * allowlist, the Henar fee transfer goes to the planned destination with
 * the planned amount, every venue leg's program is present, and no
 * instruction targets an unexpected program. Amount floors live inside the
 * venue instructions and are asserted server-side; the client re-checks
 * the fee and program set, which is what a malicious server could alter.
 */
import { PublicKey, type AddressLookupTableAccount, type VersionedTransaction } from "@solana/web3.js";
import { MARKET_FEE_BPS } from "@/lib/trade-fee";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * The one SPL-Token opcode a Henar router transaction may carry: the fee
 * transfer the builder emits. Named rather than written as a bare 12 so the
 * constraint reads as a rule instead of a magic number.
 */
const TOKEN_TRANSFER_CHECKED = 12;

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const VENUE_PROGRAMS = new Set([
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM (same `raydium` venue, poolType "cpmm")
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", // Meteora DBC
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // Meteora DAMM v2
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
]);

export type RouterPlanSummary = {
  owner: string;
  side: "buy" | "sell";
  /** "path" runs the legs in sequence through `intermediate`; absent means parallel legs on one pair. */
  kind?: "parallel" | "path";
  intermediate?: { mint: string; decimals: number; tokenProgram: string } | null;
  /** Path only: expected intermediate left in the wallet above the first hop's floor. */
  residual?: { mint: string; expected: string } | null;
  legs: { venue: string; poolAddress: string; programId: string; inputMint?: string; outputMint?: string; amountIn: string; expectedAmountOut: string; minimumAmountOut: string; programIds?: string[] }[];
  totals: { amountIn: string; expectedAmountOut: string; minimumAmountOut: string; minimumNetUserOutput: string };
  henarFee: { mint: string; amount: string; bps: number; on: "input" | "output"; destination: string; tokenProgram: string; decimals: number };
  requiredPrograms: string[];
  expiresAt: string;
};

const fail = (why: string) => {
  throw new Error(`Router transaction does not match the reviewed plan (${why}). Nothing was signed.`);
};

export function validateRouterTransaction(
  tx: VersionedTransaction,
  plan: RouterPlanSummary,
  expected: { owner: string; inputMint: string; outputMint: string; amount: bigint },
  tables: AddressLookupTableAccount[],
) {
  if (plan.owner !== expected.owner) fail("owner");
  if (BigInt(plan.totals.amountIn) !== expected.amount) fail("amount");
  if (Date.now() >= Date.parse(plan.expiresAt)) fail("expired");
  const aggregatorPrograms = new Set<string>();
  for (const leg of plan.legs) {
    if (BigInt(leg.minimumAmountOut) <= 0n) fail("leg floor");
    if (leg.programId.startsWith("aggregator:")) {
      /* Aggregator leg: the server lists the programs its instructions invoke.
         Those names came from the server, so honouring them as given would let
         the thing being checked choose what the check allows — the one thing a
         client-side validator exists to prevent. They must already be programs
         this client knows, which makes the list a narrowing of the allowlist
         rather than an extension of it. Adding a venue stays a deliberate
         change here, not something a response can do. */
      if (!leg.programIds?.length) fail("aggregator programs");
      for (const p of leg.programIds!) {
        if (!VENUE_PROGRAMS.has(p)) fail(`aggregator program ${p}`);
        aggregatorPrograms.add(p);
      }
    } else if (!VENUE_PROGRAMS.has(leg.programId)) fail("leg program");
  }
  if (plan.henarFee.bps !== MARKET_FEE_BPS) fail("fee bps");
  if (plan.kind === "path") {
    /* A path's legs must chain through the declared intermediate and end at
       the user's own pair; a leg to any other asset would move the user's
       funds somewhere the ticket never showed. */
    const i = plan.intermediate?.mint;
    if (!i || i === expected.inputMint || i === expected.outputMint) fail("path intermediate");
    for (const leg of plan.legs) {
      const okPair = plan.side === "buy"
        ? (leg.inputMint === expected.inputMint && leg.outputMint === i) || (leg.inputMint === i && leg.outputMint === expected.outputMint)
        : (leg.inputMint === expected.inputMint && leg.outputMint === i) || (leg.inputMint === i && leg.outputMint === expected.outputMint);
      if (!okPair) fail("path leg pair");
    }
    if (!plan.legs.some((l) => l.outputMint === expected.outputMint)) fail("path never reaches the output");
  }
  const feeMint = plan.henarFee.on === "input" ? expected.inputMint : expected.outputMint;
  if (plan.henarFee.mint !== feeMint) fail("fee mint");

  const msg = tx.message;
  if (msg.header.numRequiredSignatures !== 1) fail("signers");
  if (msg.staticAccountKeys[0].toBase58() !== expected.owner) fail("payer");
  if (tx.signatures.some((s) => s.some((b) => b !== 0))) fail("presigned");
  const keys = msg.getAccountKeys({ addressLookupTableAccounts: tables });
  const owner = new PublicKey(expected.owner);
  const allowed = new Set([COMPUTE_BUDGET, ATA_PROGRAM, TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), ...VENUE_PROGRAMS, ...aggregatorPrograms]);
  const legPrograms = new Set(plan.legs.filter((l) => !l.programId.startsWith("aggregator:")).map((l) => l.programId));
  const seenPrograms = new Set<string>();
  let feeTransfers = 0;
  for (const ix of msg.compiledInstructions) {
    const program = keys.get(ix.programIdIndex)!.toBase58();
    if (!allowed.has(program)) fail(`program ${program}`);
    seenPrograms.add(program);
    const accounts = ix.accountKeyIndexes.map((i) => keys.get(i)!);
    // Any account the message marks as signer must be the owner.
    for (let i = 0; i < ix.accountKeyIndexes.length; i += 1)
      if (msg.isAccountSigner(ix.accountKeyIndexes[i]) && !accounts[i].equals(owner)) fail("foreign signer");
    if (program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58()) {
      /* The token programs were allowed wholesale, and only TransferChecked
         was ever inspected. Everything else went through unread — and the
         owner is a legitimate signer, so the foreign-signer check above does
         not catch it either. A plan carrying an extra SetAuthority, Approve or
         Burn on the owner's own account would validate, simulate cleanly and
         be signed.
         The builder emits exactly one token-program instruction, the fee
         transfer, so anything else is not something we asked for. Unknown
         opcodes fail rather than pass: a venue that legitimately needs one is
         a deliberate addition here, discovered in testing, not a silent
         capability in a signing path. */
      if (ix.data[0] !== TOKEN_TRANSFER_CHECKED) fail(`token instruction ${ix.data[0]}`);
      // TransferChecked: [source, mint, destination, owner]
      const amount = Buffer.from(ix.data).readBigUInt64LE(1);
      const decimals = ix.data[9];
      if (accounts[2].toBase58() !== plan.henarFee.destination) fail("fee destination");
      if (accounts[1].toBase58() !== plan.henarFee.mint) fail("fee mint account");
      if (amount !== BigInt(plan.henarFee.amount) || decimals !== plan.henarFee.decimals) fail("fee amount");
      if (!accounts[3].equals(owner)) fail("fee authority");
      feeTransfers += 1;
    }
  }
  if (BigInt(plan.henarFee.amount) > 0n && feeTransfers !== 1) fail("fee transfer count");
  for (const p of legPrograms) if (!seenPrograms.has(p)) fail("missing venue leg");
  return { programs: [...seenPrograms], feeTransfers };
}
