import { test } from "node:test";
import assert from "node:assert/strict";
import { scaledPrice, stockDelivery } from "../src/lib/protocol/pricing";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { rawIdl, integer, pda } from "../src/lib/protocol/client";
import { PublicKey } from "@solana/web3.js";
const p = (price: string) => ({
  price,
  conf: "0",
  expo: -6,
  publish_time: 1000,
});
test("stock delivery uses the same integer rounding as the program", () => {
  assert.equal(
    stockDelivery(
      9800000n,
      p("150000000"),
      p("1000000"),
      1n,
      1n,
      8,
      0,
      1000,
      60,
      100,
    ).minimum,
    6533334n,
  );
  assert.equal(
    stockDelivery(
      10000000n,
      p("100000000"),
      p("1000000"),
      1n,
      1n,
      6,
      0,
      1000,
      60,
      100,
      undefined,
      1.5,
    ).minimum,
    66667n,
  );
});
test("stale prices, confidence and limits fail closed", () => {
  assert.throws(() =>
    stockDelivery(
      10n,
      p("100000000"),
      p("1000000"),
      1n,
      1n,
      6,
      50,
      1061,
      60,
      100,
    ),
  );
  assert.throws(() =>
    stockDelivery(
      10n,
      p("101000000"),
      p("1000000"),
      1n,
      1n,
      6,
      50,
      1000,
      60,
      100,
      100000000n,
    ),
  );
  assert.throws(() => scaledPrice(100n, NaN));
  assert.equal(scaledPrice(1n, 1.5), 2n);
});
test("generated instruction encoding preserves full u64 batch values", () => {
  const coder = new BorshInstructionCoder(rawIdl);
  const encoded = coder.encode("buy_batch", {
    id: integer("18446744073709551615"),
    count: integer(10),
    slippage_bps: 50,
  });
  assert.equal(
    encoded.subarray(8, 16).readBigUInt64LE(),
    18446744073709551615n,
  );
  assert.equal(encoded.subarray(16, 24).readBigUInt64LE(), 10n);
});
test("PDA addresses distinguish owners and full-width identifiers", () => {
  const id = new PublicKey(rawIdl.address);
  const owner = PublicKey.default;
  assert.notEqual(
    pda(id, "batch", owner, 1n).toBase58(),
    pda(id, "batch", owner, 9007199254740993n).toBase58(),
  );
});

import { assertMainnet } from "../src/lib/solana";
import type { Connection } from "@solana/web3.js";
test("mainnet verification accepts the complete genesis hash only", async () => {
  await assertMainnet({
    getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  } as Connection);
  await assert.rejects(
    assertMainnet({
      getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    } as Connection),
  );
});

import { awaitConfirmation } from "../src/lib/protocol/confirmation";
import { safeError } from "../src/lib/protocol/errors";
test("HTTP confirmation accepts confirmed, rejects failures and preserves uncertain status", async () => {
  const c = (value: unknown) =>
    ({
      getSignatureStatuses: async () => ({ value: [value] }),
      getBlockHeight: async () => 100,
    }) as unknown as Connection;
  await awaitConfirmation(
    c({ confirmationStatus: "confirmed", err: null }),
    "signature",
    101,
  );
  await assert.rejects(
    awaitConfirmation(
      c({ err: { InstructionError: [0, "Custom"] } }),
      "signature",
      101,
    ),
    /failed onchain/,
  );
  await assert.rejects(awaitConfirmation(c(null), "signature", 99), /expired/);
  await assert.rejects(
    awaitConfirmation(c(null), "signature", 101, 0),
    /pending/,
  );
});
test("provider errors redact credential-bearing URLs", () => {
  assert.equal(
    safeError(new Error("failed https://rpc.example/?api-key=secret")),
    "failed [provider]",
  );
});
