import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  transactionLimits,
  assertTransactionLimits,
} from "../src/lib/protocol/transaction-limits";
function message(count: number, dataBytes = 10, compress = false) {
  const payer = Keypair.generate().publicKey,
    program = Keypair.generate().publicKey;
  const addresses = Array.from(
    { length: count },
    () => Keypair.generate().publicKey,
  );
  const ix = new TransactionInstruction({
    programId: program,
    keys: addresses.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    })),
    data: Buffer.alloc(dataBytes),
  });
  const table = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });
  return new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ix],
  }).compileToV0Message(compress ? [table] : []);
}
test("packet measurement matches actual v0 wire encoding including long shortvecs", () => {
  for (const m of [message(2), message(20, 150), message(55, 128, true)])
    assert.equal(
      transactionLimits(m).bytes,
      new VersionedTransaction(m).serialize().length,
    );
});
test("oversized route is rejected before web3 buffer serialization", () => {
  const m = message(50, 300);
  assert.ok(transactionLimits(m).bytes > 1232);
  assert.throws(() => assertTransactionLimits(m), /exceeds mainnet limits/);
});
test("address compression cannot bypass the account-lock limit", () => {
  const m = message(65, 1, true);
  assert.ok(transactionLimits(m).bytes < 1232);
  assert.equal(transactionLimits(m).accounts, 67);
  assert.throws(() => assertTransactionLimits(m), /67\/64 accounts/);
});
