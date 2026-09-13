import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadCache } from "../src/lib/read-cache";

test("concurrent protocol reads share work without mixing wallet snapshots", async () => {
  const cached = createReadCache<string>(10000);
  let reads = 0;
  let finish!: (value: string) => void;
  const read = () => {
    reads++;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  const first = cached("wallet-a", read);
  const second = cached("wallet-a", read);
  assert.equal(reads, 1);
  assert.equal(await cached("wallet-b", async () => "B"), "B");
  finish("A");
  assert.deepEqual(await Promise.all([first, second]), ["A", "A"]);
  assert.equal(await cached("wallet-a", async () => "unexpected"), "A");
});

test("confirmed-action refresh bypasses cached reads and transient failures do not poison them", async () => {
  const cached = createReadCache<string>(10000);
  await cached("wallet", async () => "before");
  assert.equal(await cached("wallet", async () => "after", true), "after");
  await assert.rejects(
    cached(
      "wallet",
      async () => {
        throw new Error("429");
      },
      true,
    ),
  );
  assert.equal(await cached("wallet", async () => "unexpected"), "after");
  assert.equal(
    await cached("wallet", async () => "recovered", true),
    "recovered",
  );
});
