/**
 * Mint inspection on synthetic accounts: legacy Token, plain Token-2022, and
 * Token-2022 with extensions the router must refuse or may accept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  MINT_SIZE,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMintLen,
} from "@solana/spl-token";
import { inspectionFromAccount } from "@henar/router-core";

const MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const HOOK = key(7);
const DELEGATE = key(9);

function baseMintData(decimals: number) {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 0n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return data;
}

/** Token-2022 mint with a TLV list of (type, payload). */
function token2022Mint(decimals: number, extensions: { type: ExtensionType; payload: Buffer }[]) {
  const len = getMintLen(extensions.map((e) => e.type));
  const data = Buffer.alloc(Math.max(len, 166 + extensions.reduce((n, e) => n + 4 + e.payload.length, 0)));
  baseMintData(decimals).copy(data, 0);
  data[165] = 1; // AccountType::Mint
  let offset = 166;
  for (const ext of extensions) {
    data.writeUInt16LE(ext.type, offset);
    data.writeUInt16LE(ext.payload.length, offset + 2);
    ext.payload.copy(data, offset + 4);
    offset += 4 + ext.payload.length;
  }
  return data;
}

const account = (owner: PublicKey, data: Buffer) => ({ owner, data, executable: false, lamports: 1, rentEpoch: 0 });

test("legacy Token mint is supported", () => {
  const r = inspectionFromAccount(MINT, account(TOKEN_PROGRAM_ID, baseMintData(6)));
  assert.equal(r.isToken2022, false);
  assert.equal(r.decimals, 6);
  assert.equal(r.supported, true);
});

test("Token-2022 mint with no extensions is supported and reports decimals", () => {
  const r = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [])));
  assert.equal(r.isToken2022, true);
  assert.equal(r.decimals, 8);
  assert.deepEqual(r.extensions, []);
  assert.equal(r.supported, true);
});

test("transfer hook → unsupported; transfer fee at 0 bps → supported; non-zero → supported with the fee recorded (the guard confines it to net-quoting venues)", () => {
  const hook = Buffer.alloc(64);
  new PublicKey(HOOK).toBuffer().copy(hook, 32);
  const hooked = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.TransferHook, payload: hook }])));
  assert.equal(hooked.supported, false);
  assert.equal(hooked.transferHookProgram, HOOK);
  assert.match(hooked.unsupportedReason ?? "", /transfer hook/);

  const fee = (bps: number) => {
    const p = Buffer.alloc(108);
    p.writeUInt16LE(bps, 88);
    p.writeUInt16LE(bps, 106);
    return p;
  };
  const zero = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.TransferFeeConfig, payload: fee(0) }])));
  assert.equal(zero.supported, true);
  assert.equal(zero.transferFeeBps, 0);
  const fifty = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.TransferFeeConfig, payload: fee(50) }])));
  assert.equal(fifty.supported, true);
  assert.equal(fifty.transferFeeBps, 50);
});

test("scaled UI amount is supported and exposed; raw decimals are unchanged", () => {
  const p = Buffer.alloc(56);
  p.writeDoubleLE(2.5, 32); // current multiplier
  p.writeBigUInt64LE(BigInt(2 ** 40), 40); // new multiplier effective far in the future
  p.writeDoubleLE(9, 48);
  const r = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.ScaledUiAmountConfig, payload: p }])));
  assert.equal(r.supported, true);
  assert.equal(r.scaledUiMultiplier, "2.5");
  assert.equal(r.decimals, 8);
});

test("non-transferable and unknown program are refused; permanent delegate is recorded but allowed (issuer compliance control)", () => {
  const nt = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.NonTransferable, payload: Buffer.alloc(0) }])));
  assert.equal(nt.supported, false);
  assert.equal(nt.nonTransferable, true);
  const pd = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.PermanentDelegate, payload: new PublicKey(DELEGATE).toBuffer() }])));
  assert.equal(pd.supported, true);
  assert.equal(pd.permanentDelegate, DELEGATE);
  const other = inspectionFromAccount(MINT, account(PublicKey.default, baseMintData(6)));
  assert.equal(other.supported, false);
});

test("pausable mints: allowed while unpaused (the real xStocks shape: delegate + pausable), refused when paused", () => {
  const pausable = (paused: boolean) => {
    const p = Buffer.alloc(33);
    new PublicKey(DELEGATE).toBuffer().copy(p, 0);
    p[32] = paused ? 1 : 0;
    return p;
  };
  const live = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [
    { type: ExtensionType.PermanentDelegate, payload: new PublicKey(DELEGATE).toBuffer() },
    { type: ExtensionType.PausableConfig, payload: pausable(false) },
  ])));
  assert.equal(live.supported, true, live.unsupportedReason ?? "");
  assert.deepEqual(live.extensions, ["PermanentDelegate", "PausableConfig"]);
  const paused = inspectionFromAccount(MINT, account(TOKEN_2022_PROGRAM_ID, token2022Mint(8, [{ type: ExtensionType.PausableConfig, payload: pausable(true) }])));
  assert.equal(paused.supported, false);
  assert.match(paused.unsupportedReason ?? "", /paused/);
});
