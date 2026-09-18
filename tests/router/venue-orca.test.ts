/** Orca adapter offline: fail-closed paths without RPC. Live quote is LIVE_VALIDATION_PENDING. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_MINT, listRouterRepresentations, type QuoteRequest } from "@henar/router-core";
import { OrcaAdapter, ORCA_WHIRLPOOL_PROGRAM, classifyOrcaError } from "@henar/venue-orca";
import { key, pool } from "./fixtures/plan";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const request: QuoteRequest = { representationId: rep.id, side: "buy", amount: "1000000", amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint };
const orcaPool = pool("orca", key(5), { poolType: "whirlpool", programId: ORCA_WHIRLPOOL_PROGRAM });

test("orca: no pool → NO_VERIFIED_POOL; pool without RPC → VENUE_NOT_CONFIGURED; wrong mints → mismatch; exact-out unsupported", async () => {
  const a = new OrcaAdapter({ executionEnabled: false });
  assert.equal((await a.getQuote(request, { connection: null, pools: [], now: Date.now(), deadlineMs: 1000 })).unavailableReason, "NO_VERIFIED_POOL");
  const q = await a.getQuote(request, { connection: null, pools: [orcaPool], now: Date.now(), deadlineMs: 1000 });
  assert.equal(q.unavailableReason, "VENUE_NOT_CONFIGURED");
  assert.equal(q.poolAddress, key(5));
  assert.equal((await a.getQuote({ ...request, inputMint: key(9) }, { connection: {} as never, pools: [orcaPool], now: Date.now(), deadlineMs: 1000 })).unavailableReason, "QUOTE_TERMS_MISMATCH");
  assert.equal((await a.getQuote({ ...request, amountType: "output" }, { connection: null, pools: [orcaPool], now: Date.now(), deadlineMs: 1000 })).unavailableReason, "NOT_IMPLEMENTED");
  // The builder exists either way; the flag is enforced inside it.
  assert.equal(a.capabilities().nativeBuild, true);
  assert.equal(new OrcaAdapter({ executionEnabled: true }).capabilities().nativeBuild, true);
  assert.equal((await a.buildSwapInstructions({} as never, { connection: null, pools: [], now: 0, deadlineMs: 0 })).reason, "VENUE_DISABLED");
});

/**
 * Regression: a thin pool is thin, not broken.
 *
 * A whirlpool that cannot fill a size says so by running out of initialised
 * tick arrays, in a message containing neither "liquidity" nor "amount". That
 * was recorded as SDK_ERROR, so the $50k benchmark read 14 thin-pool refusals
 * as adapter faults.
 */
test("orca errors are classified by what they mean", () => {
  assert.equal(
    classifyOrcaError("Swap input value traversed too many arrays. Out of bounds at attempt to traverse tick index -11264."),
    "INSUFFICIENT_LIQUIDITY",
  );
  assert.equal(classifyOrcaError("TickArraySequenceInvalid: not enough tick arrays"), "INSUFFICIENT_LIQUIDITY");
  assert.equal(classifyOrcaError("Insufficient liquidity in pool"), "INSUFFICIENT_LIQUIDITY");
  assert.equal(classifyOrcaError("The operation was aborted"), "VENUE_TIMEOUT");
  assert.equal(classifyOrcaError("request timeout after 6000ms"), "VENUE_TIMEOUT");
  // Something genuinely unexpected stays unexpected.
  assert.equal(classifyOrcaError("Cannot read properties of undefined"), "SDK_ERROR");
});
