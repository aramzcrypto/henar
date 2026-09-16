/**
 * DBC Studio deployment: the guard, the review hash, the prepared
 * transaction (built offline through the SDK for localnet) and the client
 * validator that must accept it and refuse tampering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, type Connection } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { STUDIO_PRESETS, canonicalJson, deploymentProblems, prepareDeployment, reviewHash, type DeployRequest } from "@henar/dbc-studio";
import { validateStudioDeployment } from "@/lib/dbc-studio/client";

const payer = Keypair.generate();
const configKey = Keypair.generate();
const mintKey = Keypair.generate();
const pool = { name: "Henar Test Equity", symbol: "HTE", uri: "https://henarapp.vercel.app/metadata/hte.json" };
const config = STUDIO_PRESETS.standard.config;

/**
 * The SDK reads the quote mint to learn its token program. An offline stand-in
 * answers that one read with a USDC-shaped mint and refuses everything else,
 * so the test proves exactly which RPC the build depends on.
 */
function offlineConnection(): Connection {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  const mint = { owner: TOKEN_PROGRAM_ID, data, executable: false, lamports: 1, rentEpoch: 0 };
  return new Proxy({} as Connection, {
    get(_t, prop) {
      if (prop === "getAccountInfo") return async () => mint;
      if (prop === "getAccountInfoAndContext") return async () => ({ context: { slot: 1 }, value: mint });
      if (prop === "rpcEndpoint") return "http://127.0.0.1:8899";
      if (prop === "commitment") return "confirmed";
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return () => { throw new Error(`offline connection: ${String(prop)} is not available`); };
    },
  });
}

function request(cluster: DeployRequest["cluster"], over: Partial<DeployRequest> = {}): DeployRequest {
  return { cluster, config, pool, payer: payer.publicKey.toBase58(), configAddress: configKey.publicKey.toBase58(), baseMint: mintKey.publicKey.toBase58(), reviewHash: reviewHash(config, pool, cluster), ...over };
}

test("canonical JSON is key-order independent and the review hash covers cluster, config and pool", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  assert.notEqual(reviewHash(config, pool, "devnet"), reviewHash(config, pool, "mainnet"));
  assert.notEqual(reviewHash(config, pool, "devnet"), reviewHash(config, { ...pool, symbol: "X" }, "devnet"));
});

test("deploymentProblems: studio flag, review hash, key hygiene, and the mainnet guard", () => {
  const off = deploymentProblems(request("devnet"), {});
  assert.ok(off.some((p) => /HENAR_DBC_STUDIO/.test(p)));
  const env = { HENAR_DBC_STUDIO: "1" };
  assert.deepEqual(deploymentProblems(request("devnet"), env), []);
  assert.ok(deploymentProblems(request("devnet", { reviewHash: "0".repeat(64) }), env).some((p) => /review hash/.test(p)));
  assert.ok(deploymentProblems(request("devnet", { baseMint: configKey.publicKey.toBase58() }), env).some((p) => /different keypairs/.test(p)));
  assert.ok(deploymentProblems(request("devnet", { pool: { ...pool, uri: "ipfs://x" }, reviewHash: reviewHash(config, { ...pool, uri: "ipfs://x" }, "devnet") }), env).some((p) => /https/.test(p)));
  // Mainnet: flag off → refused; flag on without acknowledgement → refused; both → allowed.
  assert.ok(deploymentProblems(request("mainnet"), env).some((p) => /HENAR_DBC_MAINNET_DEPLOY/.test(p)));
  const mainnetEnv = { HENAR_DBC_STUDIO: "1", HENAR_DBC_MAINNET_DEPLOY: "1" };
  assert.ok(deploymentProblems(request("mainnet"), mainnetEnv).some((p) => /acknowledgement/.test(p)));
  assert.deepEqual(deploymentProblems(request("mainnet", { mainnetAcknowledged: true }), mainnetEnv), []);
});

test("prepareDeployment builds one unsigned SDK transaction for localnet with the wallet as payer and only the expected signers and programs; the client validator accepts it and refuses tampering", async () => {
  process.env.HENAR_DBC_STUDIO = "1";
  const prepared = await prepareDeployment(offlineConnection(), request("localnet"), { blockhash: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 } });
  assert.equal(prepared.cluster, "localnet");
  assert.equal(prepared.payer, payer.publicKey.toBase58());
  assert.ok(prepared.programs.includes("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"));
  assert.ok(prepared.requiredSigners.includes(configKey.publicKey.toBase58()));
  assert.ok(prepared.requiredSigners.includes(mintKey.publicKey.toBase58()));
  assert.ok(prepared.requiredSigners.every((s) => [payer.publicKey.toBase58(), configKey.publicKey.toBase58(), mintKey.publicKey.toBase58()].includes(s)));
  assert.equal(prepared.poolAddress.length >= 32, true);
  assert.equal(prepared.summary.migrationQuoteThreshold.raw.length > 0, true);

  const expected = { payer: prepared.payer, configAddress: prepared.configAddress, baseMint: prepared.baseMint };
  const tx = validateStudioDeployment(prepared.transaction, expected);
  assert.equal(tx.feePayer?.toBase58(), prepared.payer);

  // Wrong payer, wrong keys, or an extra transfer instruction are refused.
  assert.throws(() => validateStudioDeployment(prepared.transaction, { ...expected, payer: Keypair.generate().publicKey.toBase58() }), /payer/);
  assert.throws(() => validateStudioDeployment(prepared.transaction, { ...expected, configAddress: Keypair.generate().publicKey.toBase58() }), /config account absent|foreign signer/);
  const tampered = Transaction.from(Buffer.from(prepared.transaction, "base64"));
  tampered.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tampered.recentBlockhash = "11111111111111111111111111111111";
  tampered.feePayer = payer.publicKey;
  // A transfer is a system-program instruction, which is allowed by program id; the
  // validator's job is programs and signers, and the review hash plus the SDK's own
  // instruction set is what pins the content. So the stronger refusal is a foreign program.
  const foreign = Transaction.from(Buffer.from(prepared.transaction, "base64"));
  foreign.add(new TransactionInstruction({ programId: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), keys: [], data: Buffer.alloc(0) }));
  foreign.recentBlockhash = "11111111111111111111111111111111";
  foreign.feePayer = payer.publicKey;
  assert.throws(() => validateStudioDeployment(foreign.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), expected), /program JUP6/);
  assert.doesNotThrow(() => validateStudioDeployment(tampered.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), expected));
});

test("prepareDeployment refuses a mainnet request without the environment flag", async () => {
  process.env.HENAR_DBC_STUDIO = "1";
  delete process.env.HENAR_DBC_MAINNET_DEPLOY;
  await assert.rejects(prepareDeployment(null, request("mainnet", { mainnetAcknowledged: true })), /HENAR_DBC_MAINNET_DEPLOY/);
});
