import {
  PublicKey,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { buildSchema } from "../../src/lib/market";
import { USDC_KEY } from "../../src/lib/protocol/client";
export async function stockSwap(
  c: Connection,
  owner: PublicKey,
  mint: PublicKey,
  budget: bigint,
  minimum: bigint,
  maxAccounts = 32,
) {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) throw new Error("Jupiter key is required for solver routing.");
  const params = new URLSearchParams({
    inputMint: USDC_KEY.toBase58(),
    outputMint: mint.toBase58(),
    amount: budget.toString(),
    taker: owner.toBase58(),
    slippageBps: "50",
    instructionVersion: "V2",
    maxAccounts: String(maxAccounts),
  });
  const response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("No executable stock route.");
  const quote = buildSchema.parse(await response.json());
  if (
    quote.inputMint !== USDC_KEY.toBase58() ||
    quote.outputMint !== mint.toBase58() ||
    quote.inAmount !== budget.toString() ||
    BigInt(quote.otherAmountThreshold) < minimum ||
    (quote.platformFee && quote.platformFee.feeBps !== 0)
  )
    throw new Error("Route does not satisfy the onchain stock minimum.");
  const ix = (value: typeof quote.swapInstruction) =>
    new TransactionInstruction({
      programId: new PublicKey(value.programId),
      keys: value.accounts.map((a) => ({
        ...a,
        pubkey: new PublicKey(a.pubkey),
      })),
      data: Buffer.from(value.data, "base64"),
    });
  const tables = [];
  for (const address of Object.keys(
    quote.addressesByLookupTableAddress ?? {},
  )) {
    const table = await c.getAddressLookupTable(new PublicKey(address));
    if (!table.value) throw new Error("Missing route lookup table.");
    tables.push(table.value);
  }
  return {
    instructions: [
      ...quote.setupInstructions.map(ix),
      ix(quote.swapInstruction),
      ...(quote.cleanupInstruction ? [ix(quote.cleanupInstruction)] : []),
      ...quote.otherInstructions.map(ix),
    ],
    tables,
  };
}
