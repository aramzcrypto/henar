import { z } from "zod";
export const instructionSchema = z.object({
  programId: z.string(),
  accounts: z.array(
    z.object({
      pubkey: z.string(),
      isSigner: z.boolean(),
      isWritable: z.boolean(),
    }),
  ),
  data: z.string(),
});
export const buildSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string().regex(/^\d+$/),
  outAmount: z.string().regex(/^\d+$/),
  otherAmountThreshold: z.string().regex(/^\d+$/),
  slippageBps: z.number(),
  priceImpactPct: z.string(),
  platformFee: z
    .object({ amount: z.string().regex(/^\d+$/), feeBps: z.number() })
    .nullable()
    .optional(),
  setupInstructions: z.array(instructionSchema),
  swapInstruction: instructionSchema,
  cleanupInstruction: instructionSchema.nullable(),
  otherInstructions: z.array(instructionSchema),
  addressesByLookupTableAddress: z.record(z.array(z.string())).nullable(),
});
export type MarketReview = {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  expiresAt: number;
  owner: string;
  mint: string;
  inputMint: string;
  inputDecimals: number;
  feeMint: string;
  feeDecimals: number;
  amount: string;
  outAmount: string;
  minimum: string;
  decimals: number;
  protocolFee: string;
  networkFee: string;
  rent: string;
  priceImpactPct: string;
  balance: string;
};

/** V2 Build does not return V1's platformFee field; collect a reviewed fixed fee atomically. */
export function marketAmounts(
  input: bigint,
  output: bigint,
  minimum: bigint,
  inputFee: boolean,
) {
  if (input <= 0n || output <= 0n || minimum <= 0n || minimum > output)
    throw new Error("Invalid quote amounts.");
  const fee = ((inputFee ? input : output) * 25n) / 10000n;
  const swapInput = inputFee ? input - fee : input;
  const receive = inputFee ? output : output - fee,
    minReceive = inputFee ? minimum : minimum - fee;
  if (swapInput <= 0n || minReceive <= 0n)
    throw new Error("Trade amount is too small after fees.");
  return { fee, swapInput, receive, minReceive };
}
