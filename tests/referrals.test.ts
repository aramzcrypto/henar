import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  referralWallet,
  readInvitation,
  REFERRAL_WINDOW_MS,
} from "../src/lib/referrals";

const referrer = Keypair.generate().publicKey.toBase58();
const now = 1_800_000_000_000;

test("referral links only accept canonical signing wallet addresses", () => {
  assert.equal(referralWallet(referrer), referrer);
  for (const value of [
    null,
    {},
    "https://example.com",
    "",
    "<script>",
    `${referrer} `,
  ]) {
    assert.equal(referralWallet(value), null);
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("referral")],
    new PublicKey(referrer),
  );
  assert.equal(referralWallet(pda.toBase58()), null);
});

test("invitations expire after 30 days and reject future timestamps", () => {
  assert.deepEqual(
    readInvitation(JSON.stringify({ referrer, capturedAt: now - 1 }), now),
    { referrer, capturedAt: now - 1 },
  );
  assert.equal(
    readInvitation(
      JSON.stringify({ referrer, capturedAt: now - REFERRAL_WINDOW_MS }),
      now,
    ),
    null,
  );
  assert.equal(
    readInvitation(JSON.stringify({ referrer, capturedAt: now + 1 }), now),
    null,
  );
});

test("tampered or broken invitation storage never becomes referral data", () => {
  for (const raw of [
    null,
    "{",
    "null",
    "[]",
    JSON.stringify({ referrer }),
    JSON.stringify({ referrer, capturedAt: "yesterday" }),
    JSON.stringify({ referrer: "invalid", capturedAt: now }),
  ]) {
    assert.equal(readInvitation(raw, now), null);
  }
  assert.deepEqual(
    readInvitation(
      JSON.stringify({ referrer, capturedAt: now, earned: 1000 }),
      now,
    ),
    { referrer, capturedAt: now },
  );
});
