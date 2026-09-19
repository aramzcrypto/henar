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

const tick = () => new Promise((r) => setTimeout(r, 5));

test("a price cache makes the request after expiry wait for a fresh read", async () => {
  let reads = 0;
  const cache = createReadCache<number>(10);
  const read = async () => { reads += 1; return reads; };
  assert.equal(await cache("k", read), 1);
  assert.equal(await cache("k", read), 1, "inside the TTL, the snapshot is reused");
  await new Promise((r) => setTimeout(r, 15));
  /* No stale-while-revalidate: the caller waits. For a quote this is the only
     correct answer — a stale price is worse than a slow one. */
  assert.equal(await cache("k", read), 2);
  assert.equal(reads, 2);
});

test("with staleWhileRevalidate the expired request is served at once and refreshed behind it", async () => {
  let reads = 0;
  const cache = createReadCache<number>(10, 128, { staleWhileRevalidate: true });
  const read = async () => { reads += 1; return reads; };
  assert.equal(await cache("k", read), 1);
  await new Promise((r) => setTimeout(r, 15));
  // The stale value comes back immediately rather than waiting on the read.
  assert.equal(await cache("k", read), 1);
  await tick();
  // …and the refresh ran, so the next caller gets the new one.
  assert.equal(await cache("k", read), 2);
  assert.equal(reads, 2);
});

test("a failing background refresh never replaces or rejects the stale snapshot", async () => {
  let reads = 0;
  const cache = createReadCache<number>(10, 128, { staleWhileRevalidate: true });
  const read = async () => { reads += 1; if (reads > 1) throw new Error("probe failed"); return 1; };
  assert.equal(await cache("k", read), 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(await cache("k", read), 1, "stale value survives a failing refresh");
  await tick();
  assert.equal(await cache("k", read), 1, "and is still served afterwards");
});

test("fresh: true always bypasses the stale value", async () => {
  let reads = 0;
  const cache = createReadCache<number>(10_000, 128, { staleWhileRevalidate: true });
  const read = async () => { reads += 1; return reads; };
  assert.equal(await cache("k", read), 1);
  assert.equal(await cache("k", read, true), 2, "an explicit fresh read is never served stale");
});
