import type { RawAccount } from "@solana/spl-token";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  createSetAuthorityInstruction,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import usdc from "./fixtures/jupiter-usdc-build.json";
import sol from "./fixtures/jupiter-sol-build.json";
import multihop from "./fixtures/jupiter-multihop-build.json";
import { validateWalletRoute } from "../src/lib/route-policy";
import { boundedJson } from "../src/lib/request-body";
import { rpcRequest } from "../src/lib/rpc-policy";
import { assertAdmission, productMask } from "../src/lib/protocol/access";
const terms = (q: {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  swapInstruction: { accounts: { pubkey: string }[] };
}) => ({
  owner: new PublicKey(q.swapInstruction.accounts[0].pubkey),
  inputMint: new PublicKey(q.inputMint),
  outputMint: new PublicKey(q.outputMint),
  inputProgram: TOKEN_PROGRAM_ID,
  outputProgram: TOKEN_2022_PROGRAM_ID,
  amount: BigInt(q.inAmount),
  slippage: 50,
  nativeSol: true,
});
test("actual captured Jupiter USDC and SOL routes pass custody and encoded-term policy", () => {
  for (const q of [usdc, sol, multihop])
    assert(validateWalletRoute(q, terms(q)).instructions.length > 0);
});
test("intermediate ATA setup is bound to the wallet and a writable route account", () => {
  const q = structuredClone(multihop);
  q.setupInstructions[0].accounts[2].pubkey =
    Keypair.generate().publicKey.toBase58();
  assert.throws(() => validateWalletRoute(q, terms(multihop)));
  const unrelated = structuredClone(multihop);
  const intermediate = unrelated.setupInstructions[0].accounts[1].pubkey;
  unrelated.swapInstruction.accounts =
    unrelated.swapInstruction.accounts.filter((a) => a.pubkey !== intermediate);
  assert.throws(() => validateWalletRoute(unrelated, terms(multihop)));
});

test("only validated WSOL cleanup may return an empty system account or null", async () => {
  const { verifyRouteWallet } = await import("../src/lib/wallet-route-state");
  const owner = terms(multihop).owner;
  const address = multihop.cleanupInstruction!.accounts[0].pubkey;
  const tombstone = {
    owner: PublicKey.default.toBase58(),
    lamports: 0,
    executable: false,
    data: ["", "base64"],
  };
  for (const after of [null, tombstone]) {
    assert.equal(
      verifyRouteWallet(
        [{ address, before: null, closeAllowed: true }],
        [after],
        owner,
      ).size,
      0,
    );
    assert.throws(() =>
      verifyRouteWallet([{ address, before: null }], [after], owner),
    );
  }
  assert.throws(() =>
    verifyRouteWallet(
      [{ address, before: null, closeAllowed: true }],
      [{ ...tombstone, lamports: 1 }],
      owner,
    ),
  );
});
test("unrelated authority change in every upstream instruction group is rejected", () => {
  const t = terms(usdc),
    attacker = Keypair.generate().publicKey;
  const x = createSetAuthorityInstruction(
    Keypair.generate().publicKey,
    t.owner,
    AuthorityType.AccountOwner,
    attacker,
  );
  const bad = {
    programId: x.programId.toBase58(),
    accounts: x.keys.map((k) => ({ ...k, pubkey: k.pubkey.toBase58() })),
    data: x.data.toString("base64"),
  };
  for (const group of [
    "otherInstructions",
    "setupInstructions",
    "cleanupInstruction",
    "swapInstruction",
  ] as const) {
    const q = structuredClone(usdc) as Record<string, unknown>;
    q[group] = group.endsWith("Instructions") ? [bad] : bad;
    assert.throws(() => validateWalletRoute(q, t));
  }
});
test("encoded amounts, fees, router, destination, native funding and signer tampering fail closed", () => {
  const cases: Array<(q: typeof usdc) => void> = [
    (q) => (q.swapInstruction.programId = TOKEN_PROGRAM_ID.toBase58()),
    (q) =>
      (q.swapInstruction.accounts[2].pubkey =
        Keypair.generate().publicKey.toBase58()),
    (q) => (q.swapInstruction.accounts[10].isSigner = true),
    ...[8, 16, 24, 26, 28].map((offset) => (q: typeof usdc) => {
      const b = Buffer.from(q.swapInstruction.data, "base64");
      b[offset] ^= 1;
      q.swapInstruction.data = b.toString("base64");
    }),
  ];
  for (const mutate of cases) {
    const q = structuredClone(usdc);
    mutate(q);
    assert.throws(() => validateWalletRoute(q, terms(usdc)));
  }
  const q = structuredClone(sol);
  const b = Buffer.from(q.setupInstructions[1].data, "base64");
  b.writeBigUInt64LE(BigInt(q.inAmount) + 1n, 4);
  q.setupInstructions[1].data = b.toString("base64");
  assert.throws(() => validateWalletRoute(q, terms(sol)));
});
test("request body cap applies to a stream without Content-Length", async () => {
  const req = new Request("http://localhost/", {
    method: "POST",
    body: "x".repeat(20001),
  });
  await assert.rejects(boundedJson(req), /too large/);
  assert.deepEqual(
    await boundedJson(
      new Request("http://localhost/", { method: "POST", body: '{"ok":true}' }),
    ),
    { ok: true },
  );
});
test("RPC batches, unknown methods, oversized account lists and malformed transactions rejected", () => {
  const call = (method: string, params: unknown[]) => ({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  assert(rpcRequest(call("getVersion", [])));
  assert(
    rpcRequest(
      call("getBalance", [
        terms(usdc).owner.toBase58(),
        { commitment: "confirmed" },
      ]),
    ),
  );
  for (const body of [
    [call("getVersion", [])],
    call("getProgramAccounts", []),
    call("getMultipleAccounts", [
      Array(21).fill(terms(usdc).owner.toBase58()),
      {},
    ]),
    call("sendTransaction", ["AAA=", { encoding: "base64" }]),
  ])
    assert.throws(() => rpcRequest(body));
});
test("API pilot and product gates do not equate global unpause with enabled products", () => {
  const owner = terms(usdc).owner.toBase58(),
    config = {
      paused: false,
      enabledProducts: 1,
      pilotOwner: owner,
      admissionLimit: "100000000",
      admittedUsdc: "90000000",
    };
  assert.doesNotThrow(() =>
    assertAdmission(config, owner, productMask("earn", "packs"), 10000000n),
  );
  assert.throws(() =>
    assertAdmission(config, owner, productMask("limit", "packs")),
  );
  assert.throws(() =>
    assertAdmission(config, owner, productMask("earn", "stocks")),
  );
  assert.throws(() => assertAdmission(config, owner, 1, 10000001n));
  assert.throws(() =>
    assertAdmission(config, Keypair.generate().publicKey.toBase58(), 1),
  );
});

test("route simulation must preserve wallet token ownership and delegate authority", async () => {
  const { AccountLayout, unpackAccount } = await import("@solana/spl-token");
  const { verifyRouteWallet } = await import("../src/lib/wallet-route-state");
  const owner = terms(usdc).owner,
    address = Keypair.generate().publicKey,
    mint = terms(usdc).inputMint;
  const raw: RawAccount = {
    mint,
    owner,
    amount: 10n,
    delegateOption: 0,
    delegate: PublicKey.default,
    state: 1,
    isNativeOption: 0,
    isNative: 0n,
    delegatedAmount: 0n,
    closeAuthorityOption: 0,
    closeAuthority: PublicKey.default,
  };
  const encode = (v: typeof raw) => {
    const b = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(v, b);
    return b;
  };
  const info = {
    owner: TOKEN_PROGRAM_ID,
    data: encode(raw),
    lamports: 2039280,
    executable: false,
  };
  const watched = [
    {
      address: address.toBase58(),
      before: unpackAccount(address, info, TOKEN_PROGRAM_ID),
    },
  ];
  const after = (v: typeof raw) => [
    {
      owner: TOKEN_PROGRAM_ID.toBase58(),
      data: [encode(v).toString("base64"), "base64"],
      lamports: 2039280,
      executable: false,
    },
  ];
  assert(
    verifyRouteWallet(watched, after({ ...raw, amount: 5n }), owner).has(
      address.toBase58(),
    ),
  );
  assert.throws(() =>
    verifyRouteWallet(
      watched,
      after({ ...raw, owner: Keypair.generate().publicKey }),
      owner,
    ),
  );
  assert.throws(() =>
    verifyRouteWallet(
      watched,
      after({
        ...raw,
        delegateOption: 1,
        delegate: Keypair.generate().publicKey,
        delegatedAmount: 10n,
      }),
      owner,
    ),
  );
});
