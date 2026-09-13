import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { BorshInstructionCoder, BN, type Idl } from "@coral-xyz/anchor";
import q from "./fixtures/jupiter-usdc-build.json";
import idl from "../src/data/stockroom-idl.json";
import { validateWalletRoute, ROUTER } from "../src/lib/route-policy";
import { validateMarketTransaction } from "../src/lib/market-transaction";
import { validateProtocolTransaction } from "../src/lib/protocol-transaction";
import { marketAmounts, type MarketReview } from "../src/lib/market";
import { quoteAccessMessage, QUOTE_SESSION_MS } from "../src/lib/wallet-access";
import {
  verifyQuoteAccess,
  createQuoteBudget,
} from "../src/lib/wallet-access-server";
import { assertApplicationRelay } from "../src/lib/relay-policy";
import { grossForNet } from "../src/lib/trade-fee";
const blockhash = PublicKey.default.toBase58();
const compute = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
];
function marketFixture() {
  const owner = new PublicKey(q.swapInstruction.accounts[0].pubkey),
    inputMint = new PublicKey(q.inputMint),
    outputMint = new PublicKey(q.outputMint);
  const amount = grossForNet(BigInt(q.inAmount));
  const terms = marketAmounts(
    amount,
    BigInt(q.outAmount),
    BigInt(q.otherAmountThreshold),
    true,
  );
  assert.equal(terms.swapInput.toString(), q.inAmount);
  const route = validateWalletRoute(q, {
    owner,
    inputMint,
    outputMint,
    inputProgram: TOKEN_PROGRAM_ID,
    outputProgram: TOKEN_2022_PROGRAM_ID,
    amount: terms.swapInput,
    slippage: 50,
    nativeSol: true,
  });
  const feeAccount = Keypair.generate().publicKey;
  const fee = createTransferCheckedInstruction(
    getAssociatedTokenAddressSync(inputMint, owner),
    inputMint,
    feeAccount,
    owner,
    terms.fee,
    6,
  );
  const instructions = [...compute(), ...route.instructions, fee];
  const tables = Object.entries(q.addressesByLookupTableAddress || {}).map(
    ([address, values]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(address),
        state: {
          deactivationSlot: (1n << 64n) - 1n,
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: values.map((value) => new PublicKey(value)),
        },
      }),
  );
  const transaction = () =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(tables),
    );
  const review: MarketReview = {
    owner: owner.toBase58(),
    inputMint: q.inputMint,
    mint: q.outputMint,
    inputDecimals: 6,
    decimals: 9,
    amount: String(amount),
    route: q,
    inputProgram: TOKEN_PROGRAM_ID.toBase58(),
    outputProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    feeMint: q.inputMint,
    feeDecimals: 6,
    feeAccount: feeAccount.toBase58(),
    feeSetupOwner: null,
    feeInstruction: {
      programId: fee.programId.toBase58(),
      accounts: fee.keys.map((k) => ({ ...k, pubkey: k.pubkey.toBase58() })),
      data: fee.data.toString("base64"),
    },
    protocolFee: String(terms.fee),
    outAmount: String(terms.receive),
    minimum: String(terms.minReceive),
    blockhash,
    transaction: Buffer.from(transaction().serialize()).toString("base64"),
    lastValidBlockHeight: 100,
    expiresAt: Date.now() + 30_000,
    networkFee: "6400",
    rent: "0",
    priceImpactPct: q.priceImpactPct,
    balance: String(amount),
  };
  const expected = {
    owner: owner.toBase58(),
    inputMint: q.inputMint,
    outputMint: q.outputMint,
    inputDecimals: 6,
    outputDecimals: 9,
    amount,
  };
  return { transaction, instructions, review, expected, owner, tables };
}
test("browser accepts a captured route only when transaction bytes match reviewed instructions", () => {
  const f = marketFixture();
  assert.doesNotThrow(() =>
    validateMarketTransaction(f.transaction(), f.review, f.expected, f.tables),
  );
  f.instructions.push(
    SystemProgram.transfer({
      fromPubkey: f.owner,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  assert.throws(() =>
    validateMarketTransaction(f.transaction(), f.review, f.expected, f.tables),
  );
});
test("browser rejects fee inflation, altered recipient, and priority-fee inflation", () => {
  const f = marketFixture();
  assert.throws(() =>
    validateMarketTransaction(
      f.transaction(),
      { ...f.review, protocolFee: "999999" },
      f.expected,
      f.tables,
    ),
  );
  const changed = structuredClone(f.review);
  changed.feeInstruction!.accounts[2].pubkey =
    Keypair.generate().publicKey.toBase58();
  assert.throws(() =>
    validateMarketTransaction(f.transaction(), changed, f.expected, f.tables),
  );
  f.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1000000,
  });
  assert.throws(() =>
    validateMarketTransaction(f.transaction(), f.review, f.expected, f.tables),
  );
});
test("wallet proof is origin-bound, wallet-bound, signed and expiring", () => {
  const keys = generateKeyPairSync("ed25519"),
    wallet = new PublicKey(
      keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ).toBase58();
  const now = 1_800_000_000_000,
    origin = "https://henarapp.vercel.app";
  const signature = sign(
    null,
    Buffer.from(quoteAccessMessage(origin, wallet, now)),
    keys.privateKey,
  ).toString("base64");
  const authorization =
    "Bearer " +
    Buffer.from(JSON.stringify({ wallet, issuedAt: now, signature })).toString(
      "base64",
    );
  const req = new Request(origin + "/api/market", {
    headers: { authorization },
  });
  assert.equal(verifyQuoteAccess(req, wallet, now), true);
  assert.equal(verifyQuoteAccess(req, wallet, now + QUOTE_SESSION_MS), false);
  assert.equal(verifyQuoteAccess(req, wallet, now - 1), false);
  assert.equal(
    verifyQuoteAccess(req, Keypair.generate().publicKey.toBase58(), now),
    false,
  );
  assert.equal(
    verifyQuoteAccess(
      new Request("https://example.com/api/market", {
        headers: { authorization },
      }),
      wallet,
      now,
    ),
    false,
  );
  assert.equal(
    verifyQuoteAccess(
      new Request(origin + "/api/market", {
        headers: { authorization, origin: "https://evil.example" },
      }),
      wallet,
      now,
    ),
    false,
  );
});
test("quote budgets bound per-wallet work and reset only at window expiry", () => {
  const budget = createQuoteBudget();
  for (let i = 0; i < 15; i++) assert.equal(budget("owner", 1000), true);
  assert.equal(budget("owner", 1001), false);
  assert.equal(budget("other", 1001), true);
  assert.equal(budget("owner", 61000), true);
});
test("RPC relay rejects unsigned or unrelated transfers but accepts signed app transactions", () => {
  const owner = Keypair.generate();
  const build = (programId: PublicKey) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          new TransactionInstruction({
            programId,
            keys: [],
            data: Buffer.alloc(0),
          }),
        ],
      }).compileToV0Message(),
    );
  const app = build(new PublicKey(ROUTER));
  assert.throws(() =>
    assertApplicationRelay(Buffer.from(app.serialize()).toString("base64")),
  );
  app.sign([owner]);
  assert.doesNotThrow(() =>
    assertApplicationRelay(Buffer.from(app.serialize()).toString("base64")),
  );
  const unrelated = build(SystemProgram.programId);
  unrelated.sign([owner]);
  assert.throws(() =>
    assertApplicationRelay(
      Buffer.from(unrelated.serialize()).toString("base64"),
    ),
  );
});
test("contract action checks reject changed amounts and unrelated top-level instructions", () => {
  const owner = Keypair.generate().publicKey,
    mint = new PublicKey(q.inputMint),
    position = Keypair.generate().publicKey;
  const coder = new BorshInstructionCoder(idl as Idl);
  const encode = (n: number) =>
    new TransactionInstruction({
      programId: new PublicKey(idl.address),
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        {
          pubkey: Keypair.generate().publicKey,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: position, isSigner: false, isWritable: true },
      ],
      data: coder.encode("deposit_more", {
        amount: new BN(n),
        min_shares: new BN(1),
      }),
    });
  const instructions = [
    ...compute(),
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      getAssociatedTokenAddressSync(mint, owner),
      owner,
      mint,
    ),
    encode(1000),
  ];
  const tx = () =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    );
  const intent = {
    action: "deposit",
    amount: "1000",
    account: position.toBase58(),
  };
  assert.doesNotThrow(() =>
    validateProtocolTransaction(tx(), owner.toBase58(), intent, []),
  );
  instructions[3] = encode(2000);
  assert.throws(() =>
    validateProtocolTransaction(tx(), owner.toBase58(), intent, []),
  );
  instructions[3] = encode(1000);
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: position,
      lamports: 100,
    }),
  );
  assert.throws(() =>
    validateProtocolTransaction(tx(), owner.toBase58(), intent, []),
  );
});
