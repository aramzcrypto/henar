import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import {
  batchPackQuote,
  packQuantity,
  giftDraft,
} from "../src/lib/pack-actions";
test("batch purchase totals scale per-pack fees exactly", () => {
  for (const count of ["1", "5", "10", "37"]) {
    const quote = batchPackQuote(count, 200);
    assert.equal(quote.price, BigInt(count) * 10_000_000n);
    assert.equal(quote.fee, BigInt(count) * 200_000n);
    assert.equal(quote.stockValue + quote.fee, quote.price);
  }
});
test("custom quantities reject fractions, negatives, zero and total u64 overflow", () => {
  for (const value of ["", "0", "-1", "1.5", "1e3", "1844674407371"])
    assert.throws(() => packQuantity(value));
  assert.equal(packQuantity("1844674407370"), 1844674407370n);
});
test("gift drafts validate recipient, quantity and message without transferring anything", () => {
  const sender = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  assert.equal(
    giftDraft(recipient, "Enjoy your pack!", "5", sender).quantity,
    5n,
  );
  assert.throws(() => giftDraft(sender, "Hi", "1", sender));
  assert.throws(() => giftDraft("invalid", "Hi", "1", sender));
  assert.throws(() => giftDraft(recipient, "a".repeat(281), "1", sender));
  assert.throws(() => giftDraft(recipient, "Hi", "0", sender));
});
