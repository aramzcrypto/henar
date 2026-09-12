import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, Keypair } from "@solana/web3.js";
import { ata, USDC_KEY } from "../src/lib/protocol/client";
import {
  validatePackQuote,
  JUPITER_ROUTER,
} from "../services/solver/pack-swap";
const pack = Keypair.generate().publicKey,
  owner = Keypair.generate().publicKey,
  payer = Keypair.generate().publicKey,
  mint = Keypair.generate().publicKey,
  destination = ata(owner, mint);
const quote = () => ({
  inputMint: USDC_KEY.toBase58(),
  outputMint: mint.toBase58(),
  inAmount: "9800000",
  outAmount: "100001",
  otherAmountThreshold: "99500",
  slippageBps: 50,
  priceImpactPct: "0.001",
  setupInstructions: [],
  swapInstruction: {
    programId: JUPITER_ROUTER.toBase58(),
    data: Buffer.from("bb64facc31c4af140102", "hex").toString("base64"),
    accounts: [
      { pubkey: pack.toBase58(), isSigner: true, isWritable: false },
      { pubkey: ata(pack).toBase58(), isSigner: false, isWritable: true },
      { pubkey: destination.toBase58(), isSigner: false, isWritable: true },
    ],
  },
  cleanupInstruction: null,
  otherInstructions: [],
  addressesByLookupTableAddress: {},
});
const check = (q: unknown) =>
  validatePackQuote(q, pack, owner, payer, mint, destination, 9800000n, 50);
test("pack routes use exact allocation, conservative integer minimum and PDA-only signing", () => {
  const r = check(quote());
  assert.equal(r.minimum, 99501n);
  assert.ok(r.keys.every((k) => !k.isSigner));
  assert.equal(r.output, 100001n);
});
test("reject wrong routes, excessive impact, invalid amounts and permissive minima", () => {
  for (const patch of [
    { inputMint: mint.toBase58() },
    { outputMint: USDC_KEY.toBase58() },
    { inAmount: "9799999" },
    { outAmount: "0" },
    { outAmount: (1n << 64n).toString() },
    { slippageBps: 100 },
    { priceImpactPct: "0.011" },
    { priceImpactPct: "NaN" },
    { priceImpactPct: "Infinity" },
    { otherAmountThreshold: "1" },
    { platformFee: { feeBps: 2, amount: "1" } },
  ])
    assert.throws(() => check({ ...quote(), ...patch }));
});
test("reject injected programs, signers, recipients and external setup", () => {
  const q = quote();
  assert.throws(() =>
    check({
      ...q,
      swapInstruction: {
        ...q.swapInstruction,
        programId: PublicKey.default.toBase58(),
      },
    }),
  );
  for (const i of [0, 1, 2]) {
    const next = quote();
    next.swapInstruction.accounts[i].pubkey =
      Keypair.generate().publicKey.toBase58();
    assert.throws(() => check(next));
  }
  assert.throws(() => check({ ...q, otherInstructions: [q.swapInstruction] }));
  assert.throws(() => check({ ...q, setupInstructions: [q.swapInstruction] }));
  assert.throws(() => check({ ...q, cleanupInstruction: q.swapInstruction }));
});
