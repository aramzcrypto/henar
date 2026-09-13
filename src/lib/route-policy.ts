import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { buildSchema } from "./market";

export const ROUTER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const EVENT = "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf";
const U64 = (1n << 64n) - 1n;
export type RouteTerms = {
  owner: PublicKey;
  inputMint: PublicKey;
  outputMint: PublicKey;
  inputProgram: PublicKey;
  outputProgram: PublicKey;
  amount: bigint;
  slippage: number;
  nativeSol?: boolean;
};
const fail = () => {
  throw new Error("Route instructions do not match the reviewed trade.");
};
/** Strict supported route subset. Unknown router versions fail closed, never fall back to blind signing. */
export function validateWalletRoute(raw: unknown, t: RouteTerms) {
  const q = buildSchema.parse(raw);
  const input = t.inputMint.toBase58(),
    output = t.outputMint.toBase58(),
    owner = t.owner.toBase58();
  const source = getAssociatedTokenAddressSync(
    t.inputMint,
    t.owner,
    true,
    t.inputProgram,
  ).toBase58();
  const destination = getAssociatedTokenAddressSync(
    t.outputMint,
    t.owner,
    true,
    t.outputProgram,
  ).toBase58();
  const out = BigInt(q.outAmount),
    min = BigInt(q.otherAmountThreshold);
  if (
    q.inputMint !== input ||
    q.outputMint !== output ||
    BigInt(q.inAmount) !== t.amount ||
    t.amount <= 0n ||
    t.amount > U64 ||
    out <= 0n ||
    out > U64 ||
    min <= 0n ||
    min > out ||
    q.slippageBps !== t.slippage ||
    !Number.isInteger(t.slippage) ||
    t.slippage < 0 ||
    t.slippage > 100 ||
    min < (out * BigInt(10000 - t.slippage)) / 10000n ||
    q.otherInstructions.length ||
    q.setupInstructions.length > 6 ||
    (q.platformFee &&
      (q.platformFee.feeBps !== 0 || BigInt(q.platformFee.amount) !== 0n))
  )
    fail();
  const ix = q.swapInstruction,
    a = ix.accounts,
    d = Buffer.from(ix.data, "base64");
  // Jupiter RouteV2 fixed header: discriminator, input u64, quoted output u64,
  // slippage u16, platform fee u16, positive slippage fee u16, route vector.
  if (
    ix.programId !== ROUTER ||
    d.length < 35 ||
    d.length > 1024 ||
    d.subarray(0, 8).toString("hex") !== "bb64facc31c4af14" ||
    d.readBigUInt64LE(8) !== t.amount ||
    d.readBigUInt64LE(16) !== out ||
    d.readUInt16LE(24) !== t.slippage ||
    d.readUInt16LE(26) !== 0 ||
    d.readUInt16LE(28) !== 0 ||
    d.readUInt32LE(30) < 1 ||
    d.readUInt32LE(30) > 16 ||
    a.length < 10 ||
    a.length > 64
  )
    fail();
  const expected = [
    owner,
    source,
    destination,
    input,
    output,
    t.inputProgram.toBase58(),
    t.outputProgram.toBase58(),
    null,
    EVENT,
    ROUTER,
  ];
  expected.forEach((v, i) => {
    if (v && a[i].pubkey !== v) fail();
  });
  if (
    ![ROUTER, destination].includes(a[7].pubkey) ||
    !a[0].isSigner ||
    !a[1].isWritable ||
    !a[2].isWritable ||
    a.some((k) => k.isSigner && k.pubkey !== owner)
  )
    fail();
  const native = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    t.owner,
    true,
  ).toBase58();
  let wrapped = 0n,
    syncs = 0;
  const validateSetup = (v: typeof ix) => {
    const b = v.accounts,
      data = Buffer.from(v.data, "base64");
    if (v.programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      if (
        data.length !== 1 ||
        data[0] !== 1 ||
        b.length !== 6 ||
        b[0].pubkey !== owner ||
        !b[0].isSigner ||
        b.slice(1).some((k) => k.isSigner) ||
        b[2].pubkey !== owner ||
        b[4].pubkey !== SystemProgram.programId.toBase58()
      )
        fail();
      const match =
        b[3].pubkey === input
          ? t.inputProgram
          : b[3].pubkey === output
            ? t.outputProgram
            : [
                  TOKEN_PROGRAM_ID.toBase58(),
                  TOKEN_2022_PROGRAM_ID.toBase58(),
                ].includes(b[5].pubkey) &&
                a.some((k) => k.pubkey === b[1].pubkey && k.isWritable)
              ? new PublicKey(b[5].pubkey)
              : null;
      if (
        !match ||
        b[5].pubkey !== match.toBase58() ||
        b[1].pubkey !==
          getAssociatedTokenAddressSync(
            new PublicKey(b[3].pubkey),
            t.owner,
            true,
            match,
          ).toBase58()
      )
        fail();
    } else if (
      t.nativeSol &&
      input === NATIVE_MINT.toBase58() &&
      v.programId === SystemProgram.programId.toBase58()
    ) {
      if (
        data.length !== 12 ||
        data.readUInt32LE(0) !== 2 ||
        b.length !== 2 ||
        b[0].pubkey !== owner ||
        !b[0].isSigner ||
        b[1].pubkey !== native ||
        b[1].isSigner
      )
        fail();
      wrapped += data.readBigUInt64LE(4);
      if (wrapped > t.amount) fail();
    } else if (
      t.nativeSol &&
      input === NATIVE_MINT.toBase58() &&
      v.programId === TOKEN_PROGRAM_ID.toBase58()
    ) {
      if (
        data.length !== 1 ||
        data[0] !== 17 ||
        b.length !== 1 ||
        b[0].pubkey !== native ||
        b[0].isSigner ||
        ++syncs > 1
      )
        fail();
    } else fail();
  };
  q.setupInstructions.forEach(validateSetup);
  if (
    t.nativeSol &&
    input === NATIVE_MINT.toBase58() &&
    (wrapped !== t.amount || syncs !== 1)
  )
    fail();
  if (q.cleanupInstruction) {
    const v = q.cleanupInstruction,
      b = v.accounts,
      data = Buffer.from(v.data, "base64");
    if (
      !t.nativeSol ||
      (![input, output].includes(NATIVE_MINT.toBase58()) &&
        !q.setupInstructions.some(
          (s) =>
            s.programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() &&
            s.accounts[1]?.pubkey === native,
        )) ||
      v.programId !== TOKEN_PROGRAM_ID.toBase58() ||
      data.length !== 1 ||
      data[0] !== 9 ||
      b.length !== 3 ||
      b[0].pubkey !== native ||
      b[1].pubkey !== owner ||
      b[2].pubkey !== owner ||
      !b[2].isSigner ||
      b.slice(0, 2).some((k) => k.isSigner)
    )
      fail();
  }
  const convert = (v: typeof ix) =>
    new TransactionInstruction({
      programId: new PublicKey(v.programId),
      keys: v.accounts.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })),
      data: Buffer.from(v.data, "base64"),
    });
  return {
    q,
    instructions: [
      ...q.setupInstructions.map(convert),
      convert(ix),
      ...(q.cleanupInstruction ? [convert(q.cleanupInstruction)] : []),
    ],
  };
}
