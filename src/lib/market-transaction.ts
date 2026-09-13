import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  type AddressLookupTableAccount,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  buildSchema,
  instructionSchema,
  marketAmounts,
  type MarketReview,
} from "./market";
import { validateWalletRoute } from "./route-policy";

const fail = () => {
  throw new Error(
    "Transaction does not match the reviewed trade. Nothing was signed.",
  );
};
const programAllowed = (s: string) =>
  [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(s);
export function validateMarketTransaction(
  tx: VersionedTransaction,
  review: MarketReview,
  expected: {
    owner: string;
    inputMint: string;
    outputMint: string;
    inputDecimals: number;
    outputDecimals: number;
    amount: bigint;
  },
  tables: AddressLookupTableAccount[],
) {
  if (
    review.owner !== expected.owner ||
    review.inputMint !== expected.inputMint ||
    review.mint !== expected.outputMint ||
    review.inputDecimals !== expected.inputDecimals ||
    review.decimals !== expected.outputDecimals ||
    BigInt(review.amount) !== expected.amount ||
    !programAllowed(review.inputProgram) ||
    !programAllowed(review.outputProgram) ||
    tx.message.header.numRequiredSignatures !== 1 ||
    tx.message.staticAccountKeys[0].toBase58() !== expected.owner ||
    tx.signatures.some((s) => s.some((b) => b !== 0))
  )
    fail();
  const owner = new PublicKey(expected.owner),
    input = new PublicKey(expected.inputMint),
    output = new PublicKey(expected.outputMint);
  const q = buildSchema.parse(review.route);
  if (![expected.inputMint, expected.outputMint].includes(review.feeMint))
    fail();
  const inputFee = review.feeMint === expected.inputMint;
  const amounts = marketAmounts(
    expected.amount,
    BigInt(q.outAmount),
    BigInt(q.otherAmountThreshold),
    inputFee,
  );
  if (
    amounts.fee.toString() !== review.protocolFee ||
    amounts.receive.toString() !== review.outAmount ||
    amounts.minReceive.toString() !== review.minimum ||
    review.feeDecimals !==
      (inputFee ? expected.inputDecimals : expected.outputDecimals)
  )
    fail();
  const terms = {
    owner,
    inputMint: input,
    outputMint: output,
    inputProgram: new PublicKey(review.inputProgram),
    outputProgram: new PublicKey(review.outputProgram),
    amount: amounts.swapInput,
    slippage: 50,
    nativeSol: true,
  };
  const { instructions } = validateWalletRoute(q, terms);
  const suffix: TransactionInstruction[] = [];
  const feeMint = new PublicKey(review.feeMint),
    feeProgram = inputFee ? terms.inputProgram : terms.outputProgram;
  const destination = new PublicKey(review.feeAccount);
  if (review.feeSetupOwner) {
    if (!amounts.fee) fail();
    const recipient = new PublicKey(review.feeSetupOwner);
    if (
      !getAssociatedTokenAddressSync(
        feeMint,
        recipient,
        true,
        feeProgram,
      ).equals(destination)
    )
      fail();
    suffix.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        destination,
        recipient,
        feeMint,
        feeProgram,
      ),
    );
  }
  if (amounts.fee) {
    if (!review.feeInstruction) fail();
    const fee = instructionSchema.parse(review.feeInstruction);
    const bytes = Buffer.from(fee.data, "base64"),
      a = fee.accounts;
    if (
      fee.programId !== feeProgram.toBase58() ||
      bytes.length !== 10 ||
      bytes[0] !== 12 ||
      bytes.readBigUInt64LE(1) !== amounts.fee ||
      bytes[9] !== review.feeDecimals ||
      a.length < 4 ||
      a.length > 32 ||
      a[0].pubkey !==
        getAssociatedTokenAddressSync(
          feeMint,
          owner,
          false,
          feeProgram,
        ).toBase58() ||
      a[1].pubkey !== review.feeMint ||
      a[2].pubkey !== review.feeAccount ||
      a[3].pubkey !== expected.owner ||
      !a[3].isSigner ||
      a.some((k, i) => i !== 3 && k.isSigner)
    )
      fail();
    suffix.push(
      new TransactionInstruction({
        programId: feeProgram,
        data: bytes,
        keys: a.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })),
      }),
    );
  } else if (review.feeInstruction || review.feeSetupOwner) fail();
  const all = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...instructions,
    ...suffix,
  ];
  const rebuilt = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: review.blockhash,
    instructions: all,
  }).compileToV0Message(tables);
  if (
    !Buffer.from(rebuilt.serialize()).equals(
      Buffer.from(tx.message.serialize()),
    )
  )
    fail();
  return { terms, instructions };
}
