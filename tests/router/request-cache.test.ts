/**
 * One quote request, one read of each account.
 *
 * Five pools each re-read the same mints and asked for their own slot, and the
 * split optimizer read all of it a second time through curve(). In production
 * that left four of five native quotes timing out at the 6s deadline, so the
 * optimizer never had the two curves a split requires.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestScopedConnection } from "@henar/router-core";
import type { Connection } from "@solana/web3.js";

function fake() {
  const calls: string[] = [];
  const connection = {
    async getSlot(commitment?: string) {
      calls.push(`getSlot:${commitment ?? ""}`);
      return 100;
    },
    async getAccountInfo(key: unknown, commitment?: string) {
      calls.push(`getAccountInfo:${String(key)}:${commitment ?? ""}`);
      return { data: Buffer.alloc(1) };
    },
    async getMultipleAccountsInfo(keys: unknown[]) {
      calls.push(`getMultipleAccountsInfo:${keys.map(String).join(",")}`);
      return keys.map(() => null);
    },
    async sendTransaction() {
      calls.push("sendTransaction");
      return "sig";
    },
    rpcEndpoint: "https://example.invalid",
  } as unknown as Connection;
  return { connection, calls };
}

test("identical reads within a request hit the chain once", async () => {
  const { connection, calls } = fake();
  const scoped = requestScopedConnection(connection);
  scoped.begin();
  const c = scoped.connection;
  await Promise.all([c.getSlot("confirmed"), c.getSlot("confirmed"), c.getSlot("confirmed")]);
  await c.getAccountInfo("mintA" as never, "confirmed" as never);
  await c.getAccountInfo("mintA" as never, "confirmed" as never);
  assert.deepEqual(calls, ["getSlot:confirmed", "getAccountInfo:mintA:confirmed"]);
  assert.equal(scoped.stats().hits, 3);

  // Different arguments are different reads.
  await c.getAccountInfo("mintB" as never, "confirmed" as never);
  assert.equal(calls.length, 3);
});

test("a new request discards the previous one's reads", async () => {
  const { connection, calls } = fake();
  const scoped = requestScopedConnection(connection);
  scoped.begin();
  await scoped.connection.getSlot("confirmed");
  scoped.begin();
  await scoped.connection.getSlot("confirmed");
  assert.equal(calls.filter((c) => c.startsWith("getSlot")).length, 2);
});

test("the wrapper identity is stable, so SDK clients keyed on the connection are not reloaded", () => {
  const { connection } = fake();
  assert.equal(requestScopedConnection(connection), requestScopedConnection(connection));
  assert.equal(requestScopedConnection(connection).connection, requestScopedConnection(connection).connection);
});

test("writes and unknown methods are never cached", async () => {
  const { connection, calls } = fake();
  const scoped = requestScopedConnection(connection);
  scoped.begin();
  await (scoped.connection as unknown as { sendTransaction: () => Promise<string> }).sendTransaction();
  await (scoped.connection as unknown as { sendTransaction: () => Promise<string> }).sendTransaction();
  assert.equal(calls.filter((c) => c === "sendTransaction").length, 2);
  assert.equal(scoped.connection.rpcEndpoint, "https://example.invalid");
});

test("a failed read is not remembered as the answer", async () => {
  let attempts = 0;
  const connection = {
    async getSlot() {
      attempts += 1;
      if (attempts === 1) throw new Error("429");
      return 7;
    },
  } as unknown as Connection;
  const scoped = requestScopedConnection(connection);
  scoped.begin();
  await assert.rejects(scoped.connection.getSlot(), /429/);
  assert.equal(await scoped.connection.getSlot(), 7);
  assert.equal(attempts, 2);
});
