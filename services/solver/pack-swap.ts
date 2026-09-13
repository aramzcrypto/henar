import {
  PublicKey,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import { buildSchema } from "../../src/lib/market";
import {
  ata,
  common,
  integer,
  pda,
  USDC_KEY,
} from "../../src/lib/protocol/client";
import { protocolContext } from "../../src/lib/protocol/context";
import { protocolLookupTables } from "../../src/lib/protocol/lookup";
import type { Dispatcher } from "./transactions";
export const JUPITER_ROUTER = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);
const u64 = (1n << 64n) - 1n;
export function validatePackQuote(
  raw: unknown,
  pack: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  budget: bigint,
  slippage: number,
) {
  const q = buildSchema.parse(raw);
  const output = BigInt(q.outAmount),
    threshold = BigInt(q.otherAmountThreshold);
  const impact = new Decimal(q.priceImpactPct);
  if (
    q.inputMint !== USDC_KEY.toBase58() ||
    q.outputMint !== mint.toBase58() ||
    BigInt(q.inAmount) !== budget ||
    output <= 0n ||
    output > u64 ||
    threshold <= 0n ||
    threshold > output ||
    !Number.isInteger(slippage) ||
    slippage < 0 ||
    slippage > 100 ||
    q.slippageBps !== slippage ||
    !impact.isFinite() ||
    impact.abs().gt("0.01") ||
    (q.platformFee &&
      (q.platformFee.feeBps !== 0 || q.platformFee.amount !== "0"))
  )
    throw new Error(
      "Pack route exceeds price impact, slippage or allocation bounds.",
    );
  const minimum = (output * BigInt(10000 - slippage) + 9999n) / 10000n;
  // Jupiter rounds its threshold down; the contract conservatively rounds up.
  if (threshold < minimum - 1n)
    throw new Error("Pack quote minimum is inconsistent.");
  if (
    q.swapInstruction.programId !== JUPITER_ROUTER.toBase58() ||
    q.cleanupInstruction ||
    q.otherInstructions.length ||
    q.setupInstructions.length > 6
  )
    throw new Error("Unsupported pack route instructions.");
  const keys = q.swapInstruction.accounts;
  if (
    !keys.some((a) => a.pubkey === pack.toBase58() && a.isSigner) ||
    keys.some((a) => a.isSigner && a.pubkey !== pack.toBase58()) ||
    (payer.toBase58() !== pack.toBase58() &&
      keys.some((a) => a.pubkey === payer.toBase58())) ||
    !keys.some((a) => a.pubkey === ata(pack).toBase58() && a.isWritable) ||
    !keys.some((a) => a.pubkey === destination.toBase58() && a.isWritable)
  )
    throw new Error("Pack route has incorrect custody or recipient accounts.");
  const setup = q.setupInstructions.map((ix) => {
    const a = ix.accounts;
    const data = Buffer.from(ix.data, "base64");
    if (
      ix.programId !== ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() ||
      a.length !== 6 ||
      data.length !== 1 ||
      data[0] !== 1 ||
      a[0].pubkey !== payer.toBase58() ||
      !a[0].isSigner ||
      a.slice(1).some((k) => k.isSigner) ||
      ![pack.toBase58(), owner.toBase58()].includes(a[2].pubkey) ||
      a[4].pubkey !== "11111111111111111111111111111111" ||
      ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
        a[5].pubkey,
      ) ||
      a[1].pubkey !==
        ata(
          new PublicKey(a[2].pubkey),
          new PublicKey(a[3].pubkey),
          new PublicKey(a[5].pubkey),
        ).toBase58()
    )
      throw new Error("Unsupported pack account setup.");
    return new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: a.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })),
      data,
    });
  });
  const route = Buffer.from(q.swapInstruction.data, "base64");
  if (
    !["bb64facc31c4af14", "d19853937cfed8e9"].includes(
      route.subarray(0, 8).toString("hex"),
    ) ||
    route.length > 1024
  )
    throw new Error("Unsupported pack route size.");
  return {
    q,
    output,
    minimum,
    route,
    setup,
    keys: keys.map((k) => ({
      ...k,
      pubkey: new PublicKey(k.pubkey),
      isSigner: false,
    })),
  };
}
export async function fetchPackRoute(
  c: Connection,
  pack: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  budget: bigint,
  slippage: number,
  maxAccounts = 24,
) {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("Jupiter key is required for pack execution.");
  const quotedAt = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    inputMint: USDC_KEY.toBase58(),
    outputMint: mint.toBase58(),
    amount: budget.toString(),
    taker: pack.toBase58(),
    payer: payer.toBase58(),
    destinationTokenAccount: destination.toBase58(),
    slippageBps: String(slippage),
    maxAccounts: String(maxAccounts),
    wrapAndUnwrapSol: "false",
    useSharedAccounts: "false",
    instructionVersion: "V2",
  });
  const r = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok)
    throw new Error("No executable pack route; allocation remains in escrow.");
  const result = validatePackQuote(
    await r.json(),
    pack,
    owner,
    payer,
    mint,
    destination,
    budget,
    slippage,
  );
  const tables = [];
  for (const address of Object.keys(
    result.q.addressesByLookupTableAddress ?? {},
  )) {
    const t = await c.getAddressLookupTable(new PublicKey(address));
    if (!t.value) throw new Error("Pack route lookup table unavailable.");
    tables.push(t.value);
  }
  return { ...result, tables, quotedAt };
}
export async function fetchExecutablePackRoute(
  c: Connection,
  pack: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  budget: bigint,
  slippage: number,
) {
  let lastError: unknown;
  for (const maxAccounts of [24, 20, 16, 12]) {
    try {
      return await fetchPackRoute(
        c,
        pack,
        owner,
        payer,
        mint,
        destination,
        budget,
        slippage,
        maxAccounts,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No executable pack route; allocation remains in escrow.");
}
export async function executePackSwap(
  address: PublicKey,
  dispatch: Dispatcher,
  maxUSDC: bigint,
) {
  const { client, c, config, configKey, programId } = await protocolContext();
  const pack = await client.account.pack.fetch(address);
  if (!("selected" in pack.status)) return;
  const executionKey = pda(programId, "pack-execution");
  const policy = await client.account.packExecution.fetchNullable(executionKey);
  if (
    !policy?.enabled ||
    config.paused ||
    !policy.authority.equals(dispatch.signer.publicKey)
  )
    throw new Error("Pack execution is not enabled for this worker.");
  const budget = BigInt(pack.budget.toString());
  if (
    budget <= 0n ||
    budget > maxUSDC ||
    budget > BigInt(policy.maxBudget.toString())
  )
    throw new Error("Pack allocation exceeds the execution budget.");
  const manifest = await client.account.manifest.fetch(pack.manifest),
    spec = manifest.stocks[pack.stockIndex];
  if (!spec) throw new Error("Selected pack stock is unavailable.");
  const payer = dispatch.signer.publicKey,
    destination = ata(pack.owner, spec.mint, spec.tokenProgram);
  const route = await fetchExecutablePackRoute(
    c,
    address,
    pack.owner,
    payer,
    spec.mint,
    destination,
    budget,
    pack.slippageBps,
  );
  const ix = await client.methods
    .swapPack(
      integer(route.output),
      integer(route.minimum),
      integer(BigInt(route.quotedAt)),
      route.route,
    )
    .accountsStrict({
      quoteAuthority: payer,
      execution: executionKey,
      config: configKey,
      pack: address,
      manifest: pack.manifest,
      usdc: USDC_KEY,
      packCash: ata(address),
      treasury: config.treasury,
      stockMint: spec.mint,
      ownerStock: destination,
      stockProgram: spec.tokenProgram,
      tokenProgram: common.tokenProgram,
      jupiter: JUPITER_ROUTER,
    })
    .remainingAccounts(route.keys)
    .instruction();
  if (Date.now() / 1000 - route.quotedAt > 25)
    throw new Error(
      "Pack quote expired before submission; retry with a fresh quote.",
    );
  await dispatch.instructions(
    [
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        destination,
        pack.owner,
        spec.mint,
        spec.tokenProgram,
      ),
      ...route.setup,
      ix,
    ],
    [...(await protocolLookupTables(c)), ...route.tables],
  );
}
