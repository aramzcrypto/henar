/** Tasks 19–21: state worker + fake stream + memory store, deterministic. Accounts are FIXTURE bytes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { buildPoolRegistry, type StateReader } from "@henar/router-core";
import { FakeStreamSource, MemoryStateStore, StateWorker, type WorkerEvent } from "@henar/router-app";
import { key, pool } from "./fixtures/plan";

const PROGRAM = new PublicKey(key(50));
const account = (n: number) => ({ owner: PROGRAM, data: Buffer.from([n]), executable: false, lamports: 1, rentEpoch: 0 });

/** FIXTURE reader: "decodes" the first byte; throws on empty data. */
const reader: StateReader<{ value: number }> = {
  poolType: "clmm",
  decode(poolAddress, acc) {
    if (!acc.data.length) throw new Error("empty account");
    return { venue: "raydium", poolType: "clmm", poolAddress, programId: PROGRAM.toBase58(), slot: null, readAt: "", source: "fixture", baseMint: null, quoteMint: null, decoded: { value: acc.data[0] } };
  },
};

function setup(loadSlots: Record<string, number | null> = {}) {
  const registry = buildPoolRegistry([pool("raydium", key(1)), pool("raydium", key(2), { id: "b" }), pool("raydium", key(3), { id: "c", enabled: false, disabledReason: "off" })]);
  const stream = new FakeStreamSource();
  const events: WorkerEvent[] = [];
  const store = new MemoryStateStore();
  const worker = new StateWorker({
    registry,
    store,
    stream,
    readers: { clmm: reader },
    staleAfterSlots: 10,
    load: async (addresses) => addresses.map((address) => ({ address, slot: loadSlots[address] === undefined ? 100 : (loadSlots[address] ?? 0), account: loadSlots[address] === null ? null : account(1) })),
    onEvent: (e) => events.push(e),
  });
  return { worker, stream, store, events, registry };
}

test("start subscribes only enabled pools, snapshots them, and becomes ready with the sync slot", async () => {
  const { worker, stream } = setup();
  await worker.start();
  assert.deepEqual(stream.addresses, [key(1), key(2)]);
  assert.equal(worker.isReady, true);
  assert.equal(worker.readiness.currentSlot, 100);
  assert.equal(worker.readiness.synced, 2);
  const s = await worker.stateFor(key(1));
  assert.equal((s?.state.decoded as { value: number }).value, 1);
  assert.equal(s?.state.source, "rpc");
});

test("readiness requires every pool: a missing account keeps the worker not-ready and stateFor fails closed", async () => {
  const { worker } = setup({ [key(2)]: null });
  await worker.start();
  assert.equal(worker.isReady, false);
  assert.match(worker.readiness.reason, /1 of 2 pools/);
  assert.equal(await worker.stateFor(key(1)), null);
});

test("stream updates advance state and slot; out-of-order updates never overwrite newer state", async () => {
  const { worker, stream, store } = setup();
  await worker.start();
  stream.push(key(1), 105, account(5));
  await tick();
  assert.equal((await store.get(key(1)))!.slot, 105);
  assert.equal(worker.readiness.currentSlot, 105);
  stream.push(key(1), 103, account(3));
  await tick();
  assert.equal((await store.get(key(1)))!.slot, 105);
  assert.equal(((await worker.stateFor(key(1)))!.state.decoded as { value: number }).value, 5);
  stream.slot(120);
  await tick();
  assert.equal(worker.readiness.currentSlot, 120);
});

test("stale detection: a pool not updated within staleAfterSlots is stale and not served", async () => {
  const { worker, stream } = setup();
  await worker.start();
  stream.slot(111); // 11 slots past the snapshot at 100
  await tick();
  const statuses = await worker.poolStatuses();
  assert.equal(statuses.every((s) => s.stale), true);
  assert.equal(await worker.stateFor(key(1)), null);
  stream.push(key(1), 111, account(2));
  await tick();
  assert.equal((await worker.poolStatuses()).find((s) => s.poolAddress === key(1))!.stale, false);
  assert.ok(await worker.stateFor(key(1)));
});

test("disconnect → not ready; reconnect → full resync before ready again", async () => {
  const { worker, stream, events } = setup();
  await worker.start();
  stream.disconnect("socket closed");
  await tick();
  assert.equal(worker.isReady, false);
  assert.match(worker.readiness.reason, /disconnected/);
  stream.reconnect();
  await tick();
  assert.equal(worker.isReady, true);
  assert.equal(worker.readiness.reconnects, 1);
  assert.equal(events.filter((e) => e.type === "sync-start").length, 2);
});

test("decode errors are counted and never poison the store", async () => {
  const { worker, stream, store } = setup();
  await worker.start();
  stream.push(key(1), 106, { ...account(1), data: Buffer.alloc(0) });
  await tick();
  assert.equal(worker.readiness.decodeErrors, 1);
  assert.equal((await store.get(key(1)))!.slot, 100);
});

test("memory store keeps the highest slot and rejects older writes", async () => {
  const store = new MemoryStateStore();
  const st = reader.decode(key(1), account(1));
  await store.set({ poolAddress: key(1), venue: "raydium", slot: 10, updatedAt: "", state: st });
  await store.set({ poolAddress: key(1), venue: "raydium", slot: 9, updatedAt: "", state: st });
  assert.equal((await store.get(key(1)))!.slot, 10);
  assert.equal(await store.currentSlot(), 10);
  await store.clear();
  assert.equal(await store.currentSlot(), null);
});

const tick = () => new Promise((r) => setImmediate(r));
