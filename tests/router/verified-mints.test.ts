/**
 * Verified mint facts.
 *
 * Decimals and the token program decide the magnitude of every amount and
 * which SPL program the instructions target. They are read from chain or they
 * are absent; there is no default and no catalogue fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  buildVerifiedMints,
  listRouterRepresentations,
  loadVerifiedMints,
  routerRepresentation,
  validateVerifiedMint,
  verifiedMint,
  verifiedMintFromInspection,
  type MintInspection,
  type VerifiedMint,
} from "@henar/router-core";

const MINT = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

const row = (over: Partial<VerifiedMint> = {}): VerifiedMint => ({
  mint: MINT,
  tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
  decimals: 8,
  isToken2022: true,
  extensions: ["ScaledUiAmountConfig"],
  transferFeeBps: null,
  transferHookProgram: null,
  scaledUiMultiplier: "1",
  permanentDelegate: null,
  nonTransferable: false,
  supported: true,
  unsupportedReason: null,
  slot: 447_000_000,
  verifiedAt: "2026-09-15T00:00:00.000Z",
  ...over,
});

test("a row is rejected unless every execution-critical fact is well formed", () => {
  assert.deepEqual(validateVerifiedMint(row()), []);
  assert.ok(validateVerifiedMint(row({ mint: "nope!" })).some((m) => /mint is not base58/.test(m)));
  assert.ok(validateVerifiedMint(row({ tokenProgram: "nope!" })).some((m) => /tokenProgram/.test(m)));
  for (const decimals of [-1, 19, 6.5, Number.NaN])
    assert.ok(validateVerifiedMint(row({ decimals })).some((m) => /decimals/.test(m)), `decimals ${decimals}`);
  assert.ok(validateVerifiedMint(row({ slot: 0 })).some((m) => /slot/.test(m)));
  assert.ok(validateVerifiedMint(row({ verifiedAt: "soon" })).some((m) => /verifiedAt/.test(m)));
  assert.ok(validateVerifiedMint(row({ supported: false, unsupportedReason: null })).some((m) => /no reason/.test(m)));
  assert.ok(validateVerifiedMint(row({ supported: true, unsupportedReason: "transfer hook" })).some((m) => /carries an unsupportedReason/.test(m)));
  assert.throws(() => buildVerifiedMints([row(), row()]), /Duplicate/);
  assert.throws(() => buildVerifiedMints([row({ decimals: 99 })]), /Invalid verified mint/);
});

test("an inspection becomes a row of chain facts only, with extensions ordered", () => {
  const inspection: MintInspection = {
    mint: MINT,
    program: TOKEN_2022_PROGRAM_ID.toBase58(),
    decimals: 8,
    isToken2022: true,
    extensions: ["TokenMetadata", "ScaledUiAmountConfig"],
    transferFeeBps: null,
    transferHookProgram: null,
    scaledUiMultiplier: "1.5",
    permanentDelegate: null,
    nonTransferable: false,
    supported: true,
    unsupportedReason: null,
    readAt: "2026-09-15T00:00:00.000Z",
  };
  const built = verifiedMintFromInspection(inspection, 447_000_001, "2026-09-15T01:00:00.000Z");
  assert.deepEqual(built.extensions, ["ScaledUiAmountConfig", "TokenMetadata"]);
  assert.equal(built.tokenProgram, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(built.slot, 447_000_001);
  assert.equal(built.verifiedAt, "2026-09-15T01:00:00.000Z");
  assert.deepEqual(validateVerifiedMint(built), []);
});

test("the committed artifact is valid, deduplicated and sorted by mint", () => {
  const loaded = loadVerifiedMints();
  assert.ok(loaded.size > 0, "artifact is empty; run npm run router:verify:mints");
  const mints = [...loaded.keys()];
  assert.deepEqual(mints, [...mints].sort(), "artifact is not sorted by mint");
  for (const entry of loaded.values()) assert.deepEqual(validateVerifiedMint(entry), [], entry.mint);
});

test("representations take decimals and token program only from the artifact", () => {
  const reps = listRouterRepresentations();
  for (const rep of reps.slice(0, 200)) {
    const facts = verifiedMint(rep.mint);
    assert.equal(rep.decimals, facts?.decimals ?? null, rep.mint);
    assert.equal(rep.tokenProgram, facts?.tokenProgram ?? null, rep.mint);
    // Extensions travel with the facts, never invented alongside them.
    if (facts) assert.equal(rep.tokenExtensions?.readAt, facts.verifiedAt, rep.mint);
    else assert.equal(rep.tokenExtensions, null, rep.mint);
  }
  // A mint nobody verified stays unverified rather than acquiring a default.
  assert.equal(verifiedMint("11111111111111111111111111111111"), null);
  assert.equal(routerRepresentation("unverified:mint"), null);
});
