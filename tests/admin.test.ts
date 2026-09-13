import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  adminMessage,
  ADMIN_SESSION_MS,
  verifyAdminProof,
} from "../src/lib/admin/auth";
import {
  aggregateAdmin,
  type PositionRecord,
  type BatchRecord,
  type PackRecord,
} from "../src/lib/admin/aggregate";
const keys = generateKeyPairSync("ed25519");
const wallet = new PublicKey(
  keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
).toBase58();
const now = 1_800_000_000_000,
  origin = "https://henarapp.vercel.app";
function proof(issuedAt = now, website = origin) {
  const signature = sign(
    null,
    Buffer.from(adminMessage(website, wallet, issuedAt)),
    keys.privateKey,
  ).toString("base64");
  return (
    "Bearer " +
    Buffer.from(JSON.stringify({ wallet, issuedAt, signature })).toString(
      "base64",
    )
  );
}
test("admin access requires the allowed wallet's valid origin-bound signature", () => {
  assert.equal(verifyAdminProof(proof(), origin, [wallet], now), wallet);
  assert.equal(verifyAdminProof(proof(), origin, [], now), null);
  assert.equal(
    verifyAdminProof(proof(), "https://attacker.example", [wallet], now),
    null,
  );
  assert.equal(
    verifyAdminProof(
      proof(now, "https://attacker.example"),
      origin,
      [wallet],
      now,
    ),
    null,
  );
  assert.equal(verifyAdminProof(null, origin, [wallet], now), null);
  assert.equal(
    verifyAdminProof("Bearer " + "a".repeat(2000), origin, [wallet], now),
    null,
  );
});
test("admin proofs expire and future timestamps cannot extend sessions", () => {
  assert.equal(
    verifyAdminProof(proof(now - ADMIN_SESSION_MS), origin, [wallet], now),
    null,
  );
  assert.equal(verifyAdminProof(proof(now + 1), origin, [wallet], now), null);
  assert.equal(
    verifyAdminProof(proof(now - ADMIN_SESSION_MS + 1), origin, [wallet], now),
    wallet,
  );
});
test("altering a signed identity or time is rejected", () => {
  const value = JSON.parse(Buffer.from(proof().slice(7), "base64").toString());
  value.issuedAt -= 1;
  assert.equal(
    verifyAdminProof(
      "Bearer " + Buffer.from(JSON.stringify(value)).toString("base64"),
      origin,
      [wallet],
      now,
    ),
    null,
  );
  value.signature = Buffer.alloc(64).toString("base64");
  assert.equal(
    verifyAdminProof(
      "Bearer " + Buffer.from(JSON.stringify(value)).toString("base64"),
      origin,
      [wallet],
      now,
    ),
    null,
  );
});
const key = (s: string) => ({ toBase58: () => s });
const position: PositionRecord = {
  address: "position",
  owner: key(wallet),
  kind: { earn: {} },
  status: { active: {} },
  principalBasis: "900719925474099300",
  yieldFees: "17",
  stockUsdcSpent: "500",
  createdAt: "100",
  updatedAt: "200",
};
const batch: BatchRecord = {
  address: "batch",
  owner: key(wallet),
  creator: key(wallet),
  remaining: "3",
  unitFee: "200000",
  createdAt: "100",
};
const pack: PackRecord = {
  address: "pack",
  owner: key(wallet),
  batch: key("batch"),
  status: { pending: {} },
  lucky: false,
  unitFee: "200000",
  stockValue: "0",
  createdAt: "100",
  settledAt: "0",
  expiresAt: "9999999999",
};
test("analytics preserves exact accounting and deduplicates wallets across products", () => {
  const result = aggregateAdmin(
    [position, { ...position, address: "limit", kind: { limit: {} } }],
    [batch],
    [pack],
    1,
    false,
    now,
  );
  assert.equal(result.totals.wallets, 1);
  assert.equal(result.totals.principal, "1801439850948198600");
  assert.equal(result.totals.yieldFees, "34");
  assert.equal(result.totals.sealed, "3");
  assert.equal(result.totals.activeOrders, 1);
  assert.equal(
    result.products.find((p) => p.name === "Market")!.accounts,
    null,
  );
  assert.equal(
    result.products.find((p) => p.name === "Earn")!.status,
    "Enabled by policy",
  );
  assert.equal(
    result.products.find((p) => p.name === "Limit")!.status,
    "Disabled",
  );
});
test("Random fee counts only on settlement; Lucky fee counts once even after rollover/refund", () => {
  const result = aggregateAdmin(
    [],
    [batch],
    [
      pack,
      {
        ...pack,
        address: "settled",
        status: { settled: {} },
        stockValue: "9800000",
      },
      {
        ...pack,
        address: "lucky",
        lucky: true,
        unitFee: "0",
        status: { refunded: {} },
      },
    ],
    63,
    false,
    now,
  );
  assert.equal(result.totals.packFees, "400000");
  assert.equal(
    result.products.find((p) => p.name === "Random Packs")!.recordedPackFees,
    "200000",
  );
  assert.equal(
    result.products.find((p) => p.name === "Lucky Packs")!.recordedPackFees,
    "200000",
  );
  assert.equal(
    result.products.find((p) => p.name === "Random Packs")!.deliveredBudget,
    "9800000",
  );
});
test("missing Lucky provenance stays unavailable; awaiting user Bank is not overdue settlement", () => {
  const result = aggregateAdmin(
    [],
    [],
    [{ ...pack, lucky: true, status: { luckyReady: {} }, expiresAt: "1" }],
    63,
    false,
    now,
  );
  assert.equal(result.totals.packFees, null);
  assert.equal(result.totals.overduePacks, 0);
  assert.equal(result.totals.pendingPacks, 1);
});
