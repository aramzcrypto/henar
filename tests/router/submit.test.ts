/** Task 17: submission policy with FAKE transports. No transaction leaves the process. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { JitoSubmitter, JupiterProtectedSubmitter, RpcSubmitter, submitWithPolicy, type Submitter, type SubmitResponse } from "@henar/tx-builder";
import { OWNER } from "./fixtures/plan";

const tx = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(OWNER), recentBlockhash: "11111111111111111111111111111111", instructions: [] }).compileToV0Message());

function fake(name: string, kind: "private" | "public", script: Array<Partial<SubmitResponse>>): Submitter & { calls: number } {
  const s = {
    name,
    kind,
    calls: 0,
    async submit(): Promise<SubmitResponse> {
      const step = script[Math.min(s.calls, script.length - 1)];
      s.calls += 1;
      return { submitter: name, kind, accepted: false, signature: null, providerId: null, retryable: false, error: null, submittedAt: "", ...step };
    },
  };
  return s;
}

const policy = (over = {}) => ({ allowPublicFallback: false, maxAttemptsPerSubmitter: 3, retryDelayMs: 0, currentBlockHeight: async () => 100, ...over });
const on = { executionEnabled: true, privateSubmitEnabled: true, sleep: async () => {} };

test("execution flag off → disabled, nothing called", async () => {
  const jito = fake("jito", "private", [{ accepted: true, providerId: "b1" }]);
  const r = await submitWithPolicy(tx, [jito], 200, policy(), { ...on, executionEnabled: false });
  assert.equal(r.status, "disabled");
  assert.equal(jito.calls, 0);
});

test("first private acceptance ends the process; the public endpoint is never touched", async () => {
  const jito = fake("jito", "private", [{ accepted: true, providerId: "b1" }]);
  const jup = fake("jupiter-protected", "private", [{ accepted: true, signature: "s" }]);
  const rpc = fake("rpc", "public", [{ accepted: true, signature: "pub" }]);
  const r = await submitWithPolicy(tx, [jito, jup, rpc], 200, policy({ allowPublicFallback: true }), on);
  assert.equal(r.status, "accepted");
  assert.equal(r.accepted?.submitter, "jito");
  assert.equal(jup.calls, 0);
  assert.equal(rpc.calls, 0);
});

test("retryable private failures retry up to the limit, then the next private submitter; no public fallback unless policy allows", async () => {
  const jito = fake("jito", "private", [{ retryable: true, error: "429" }]);
  const jup = fake("jupiter-protected", "private", [{ retryable: false, error: "rejected" }]);
  const rpc = fake("rpc", "public", [{ accepted: true, signature: "pub" }]);
  const r = await submitWithPolicy(tx, [jito, jup, rpc], 200, policy(), on);
  assert.equal(r.status, "exhausted");
  assert.equal(jito.calls, 3);
  assert.equal(jup.calls, 1);
  assert.equal(rpc.calls, 0);
  assert.match(r.detail, /not allowed by policy/);
  const fallback = await submitWithPolicy(tx, [fake("jito", "private", [{ retryable: false, error: "x" }]), rpc], 200, policy({ allowPublicFallback: true }), on);
  assert.equal(fallback.status, "accepted");
  assert.equal(fallback.accepted?.kind, "public");
});

test("a supposedly private transaction is never fanned out to several public endpoints", async () => {
  const a = fake("rpc-a", "public", [{ accepted: true }]);
  const b = fake("rpc-b", "public", [{ accepted: true }]);
  await assert.rejects(submitWithPolicy(tx, [a, b], 200, policy({ allowPublicFallback: true }), on), /more than one public endpoint/);
});

test("expiry: once the block height passes lastValidBlockHeight no further attempts are made", async () => {
  let height = 199;
  const jito = fake("jito", "private", [{ retryable: true, error: "429" }]);
  const r = await submitWithPolicy(tx, [jito], 200, policy({ currentBlockHeight: async () => (height += 1) }), on);
  assert.equal(r.status, "expired");
  assert.ok(jito.calls <= 1);
});

test("private submit flag off skips private submitters; only an allowed public fallback can accept", async () => {
  const jito = fake("jito", "private", [{ accepted: true }]);
  const rpc = fake("rpc", "public", [{ accepted: true, signature: "pub" }]);
  const r = await submitWithPolicy(tx, [jito, rpc], 200, policy({ allowPublicFallback: true }), { ...on, privateSubmitEnabled: false });
  assert.equal(jito.calls, 0);
  assert.equal(r.accepted?.submitter, "rpc");
  const none = await submitWithPolicy(tx, [jito, rpc], 200, policy(), { ...on, privateSubmitEnabled: false });
  assert.equal(none.status, "exhausted");
});

test("transport-backed submitters normalize provider responses (fake transports)", async () => {
  const jito = new JitoSubmitter(async () => ({ ok: true, status: 200, json: { result: "bundle-1" } }));
  const j = await jito.submit(tx, { lastValidBlockHeight: 1 });
  assert.deepEqual([j.accepted, j.providerId, j.kind], [true, "bundle-1", "private"]);
  const jitoDown = new JitoSubmitter(async () => ({ ok: false, status: 503, json: { error: { message: "busy" } } }));
  const d = await jitoDown.submit(tx, { lastValidBlockHeight: 1 });
  assert.deepEqual([d.accepted, d.retryable, d.error], [false, true, "busy"]);
  const jup = new JupiterProtectedSubmitter(async () => ({ ok: true, status: 200, json: { signature: "sig", requestId: "r1" } }));
  const p = await jup.submit(tx, { lastValidBlockHeight: 1 });
  assert.deepEqual([p.accepted, p.signature, p.providerId], [true, "sig", "r1"]);
  const rpc = new RpcSubmitter(async () => "sig2");
  assert.equal((await rpc.submit(tx, { lastValidBlockHeight: 1 })).signature, "sig2");
  const rpcFail = new RpcSubmitter(async () => {
    throw new Error("Blockhash not found");
  });
  assert.equal((await rpcFail.submit(tx, { lastValidBlockHeight: 1 })).retryable, true);
});
