/**
 * Capability audit across every adapter the router ships.
 *
 * Two things must stay true of all of them, and neither was checked before:
 *
 *   nativeBuild === true   the builder is real — it runs its own body and
 *                          refuses for a stated reason, rather than being a
 *                          stub the planner would call and get nothing from.
 *   nativeBuild === false  the venue cannot enter an executable native plan.
 *
 * The audit is written over the real adapter list rather than fixtures, so a
 * new venue is covered the moment it is added here — which is the point: the
 * defect this guards against was a declared capability nobody read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { executableAsNativeLeg, isPoolVenue, unavailableQuote, USDC_MINT, type QuoteRequest, type VenueAdapter } from "@henar/router-core";
import { JupiterAdapter } from "@henar/venue-jupiter";
import { RaydiumAdapter, RaydiumCpmmAdapter } from "@henar/venue-raydium";
import { OrcaAdapter } from "@henar/venue-orca";
import { MeteoraAdapter } from "@henar/venue-meteora";
import { MeteoraDbcAdapter } from "@henar/venue-meteora-dbc";
import { MeteoraDammV2Adapter } from "@henar/venue-meteora-damm-v2";
import { ByrealAdapter } from "@henar/venue-byreal";
import { OpenOceanAdapter } from "@henar/venue-openocean";

const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();

/** Every adapter the quote route wires, with execution on where it is an option. */
const ADAPTERS: VenueAdapter[] = [
  new RaydiumAdapter({ executionEnabled: true }),
  new RaydiumCpmmAdapter({ executionEnabled: true }),
  new OrcaAdapter({ executionEnabled: true }),
  new MeteoraAdapter({ executionEnabled: true }),
  new MeteoraDbcAdapter({ executionEnabled: true }),
  new MeteoraDammV2Adapter({ executionEnabled: true }),
  new ByrealAdapter(),
  new JupiterAdapter(),
  new OpenOceanAdapter(),
];

test("every adapter declaring nativeBuild has a builder that actually runs", async () => {
  const request: QuoteRequest = { representationId: "x", side: "buy", amount: "1000000", amountType: "input", inputMint: USDC_MINT, outputMint: key(9) };
  for (const adapter of ADAPTERS) {
    const caps = adapter.capabilities();
    if (!caps.nativeBuild) continue;
    const quote = unavailableQuote(caps.venue, request, "SDK_ERROR", null, key(1), Date.now());
    const built = await adapter.buildSwapInstructions(quote, { connection: null, pools: [], now: Date.now(), deadlineMs: 1_000 });
    /* NOT_IMPLEMENTED is the stub's answer. A real builder reaches its own
       validation and refuses for a reason about *this* call — which is what
       the planner depends on to distinguish "cannot build here" from "cannot
       build at all". */
    assert.notEqual(built.reason, "NOT_IMPLEMENTED", `${caps.venue} declares nativeBuild but its builder is a stub`);
    assert.equal(built.instructions.length, 0, `${caps.venue} returned instructions for an unavailable quote`);
  }
});

test("every adapter without nativeBuild cannot enter an executable native plan", async () => {
  for (const adapter of ADAPTERS) {
    const caps = adapter.capabilities();
    if (caps.nativeBuild) continue;
    assert.equal(executableAsNativeLeg(caps), false, `${caps.venue} must not be eligible as a native leg`);
    if (isPoolVenue(caps)) {
      /* A pool venue without a builder is the dangerous case: it quotes
         against the registry and would otherwise be rankable. */
      const request: QuoteRequest = { representationId: "x", side: "buy", amount: "1000000", amountType: "input", inputMint: USDC_MINT, outputMint: key(9) };
      const quote = unavailableQuote(caps.venue, request, "SDK_ERROR", null, key(1), Date.now());
      const built = await adapter.buildSwapInstructions(quote, { connection: null, pools: [], now: Date.now(), deadlineMs: 1_000 });
      assert.equal(built.instructions.length, 0, `${caps.venue} has no builder but produced instructions`);
    }
  }
});

test("the capability triple is coherent for every adapter", () => {
  for (const adapter of ADAPTERS) {
    const caps = adapter.capabilities();
    assert.equal(caps.venue, adapter.venue, "capabilities must describe the adapter's own venue");
    assert.equal(caps.quote, true, `${caps.venue} is wired into the engine but declares it cannot quote`);
    /* Aggregators carry no registry pool and execute through their own
       builder; pool venues are built by Henar. A venue claiming both, or
       neither with pools declared, is a wiring mistake. */
    if (isPoolVenue(caps)) assert.equal(caps.legacyExecution, false, `${caps.venue} is a pool venue and must not claim legacy execution`);
    else assert.equal(caps.nativeBuild, false, `${caps.venue} declares no pool types and cannot be a native leg`);
  }
});
