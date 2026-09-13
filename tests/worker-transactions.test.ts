import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Connection,
  type VersionedTransaction,
} from "@solana/web3.js";
import { Dispatcher } from "../services/solver/transactions";
test("worker sizes compute from simulation before passing the transaction to signing", async () => {
  let sent: VersionedTransaction | undefined;
  const c = {
    getLatestBlockhash: async () => ({
      blockhash: PublicKey.default.toBase58(),
    }),
    simulateTransaction: async () => ({
      value: { err: null, unitsConsumed: 200000 },
    }),
  } as unknown as Connection;
  const signer = Keypair.generate(),
    d = new Dispatcher(c, signer, async () => {});
  d.signed = async (tx) => {
    sent = tx;
  };
  await d.instructions([
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  ]);
  assert(sent);
  const data = Buffer.from(sent.message.compiledInstructions[0].data);
  assert.equal(data.readUInt32LE(1), 250000);
});
test("worker never signs or submits a failed or unmeasured compute probe", async () => {
  for (const value of [
    { err: { InstructionError: [1, "fail"] }, unitsConsumed: 1 },
    { err: null, unitsConsumed: undefined },
  ]) {
    const c = {
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
      }),
      simulateTransaction: async () => ({ value }),
    } as unknown as Connection;
    const d = new Dispatcher(c, Keypair.generate(), async () => {});
    let sent = false;
    d.signed = async () => {
      sent = true;
    };
    await assert.rejects(d.instructions([]));
    assert.equal(sent, false);
  }
});
