import { inspectRouteWallet } from "../../src/lib/wallet-route-state";
import { validateWalletRoute } from "../../src/lib/route-policy";
import { verifiedMint } from "../../src/lib/solana";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";
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
    useSharedAccounts: "false",
    wrapAndUnwrapSol: "false",
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
  const stock = await verifiedMint(c, mint.toBase58());
  const terms = {
    owner,
    inputMint: USDC_KEY,
    outputMint: mint,
    inputProgram: TOKEN_PROGRAM_ID,
    outputProgram: new PublicKey(stock.program),
    amount: budget,
    slippage: 50,
  };
  const validated = validateWalletRoute(quote, terms);
  await inspectRouteWallet(c, validated.instructions, terms);
  const tables = [];
  for (const address of Object.keys(
    quote.addressesByLookupTableAddress ?? {},
  )) {
    const table = await c.getAddressLookupTable(new PublicKey(address));
    if (!table.value) throw new Error("Missing route lookup table.");
    tables.push(table.value);
  }
  return {
    instructions: validated.instructions,
    tables,
  };
}
