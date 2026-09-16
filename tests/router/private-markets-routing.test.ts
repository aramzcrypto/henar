/**
 * Private-market products inside the router: registered as their own asset
 * class, gated by HENAR_PRIVATE_MARKETS_ROUTING, never substituted for one
 * another, and settled only through venues that quote net of a Token-2022
 * transfer fee.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  USDC_MINT,
  buildPoolRegistry,
  listRouterRepresentations,
  privateMarketsRoutingEnabled,
  rankQuote,
  routerRepresentationForMint,
  unavailableQuote,
  validateQuoteRequest,
  type QuoteRequest,
  type RankedQuote,
  type Venue,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardQuote } from "@henar/execution-guard";
import { MARKET_FEE_BPS } from "@/lib/trade-fee";

const NOW = 1_800_000_000_000;
const SLOT = 300_000_000;
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();

/** A private-market representation shaped like the artifact produces. */
const privateRep = listRouterRepresentations().find((r) => r.assetClass === "PRIVATE_MARKET_EXPOSURE") ?? null;
const publicRep = listRouterRepresentations().find((r) => r.assetClass === "PUBLIC_EQUITY" && r.status === "ACTIVE")!;

test("every representation carries an asset class; public equities are never PRIVATE_MARKET_EXPOSURE", () => {
  const all = listRouterRepresentations();
  assert.ok(all.length > 0);
  for (const rep of all) assert.ok(rep.assetClass === "PUBLIC_EQUITY" || rep.assetClass === "PRIVATE_MARKET_EXPOSURE");
  assert.equal(publicRep.assetClass, "PUBLIC_EQUITY");
  assert.ok(["xstocks", "backpack", "ondo"].includes(publicRep.provider));
});

test("private-market routing is off unless explicitly enabled", () => {
  assert.equal(privateMarketsRoutingEnabled({}), false);
  assert.equal(privateMarketsRoutingEnabled({ HENAR_PRIVATE_MARKETS_ROUTING: "0" }), false);
  assert.equal(privateMarketsRoutingEnabled({ HENAR_PRIVATE_MARKETS_ROUTING: "1" }), true);
  assert.equal(privateMarketsRoutingEnabled({ HENAR_PRIVATE_MARKETS_ROUTING: "true" }), true);
});

test("public-equity quote validation is unchanged by the private-market gate", () => {
  const request: QuoteRequest = { representationId: publicRep.id, side: "buy", amount: "1000000", amountType: "input", inputMint: USDC_MINT, outputMint: publicRep.mint };
  delete process.env.HENAR_PRIVATE_MARKETS_ROUTING;
  assert.equal(validateQuoteRequest(request).ok, true);
  // A pair that is not {USDC, representation} is still out of scope.
  assert.equal(validateQuoteRequest({ ...request, outputMint: key(9) }).ok, false);
});

test("a private-market request is refused while the flag is off and admitted when it is on", { skip: privateRep ? false : "no private-market product in the committed artifact" }, () => {
  const rep = privateRep!;
  const request: QuoteRequest = { representationId: rep.id, side: "buy", amount: "1000000", amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint };
  delete process.env.HENAR_PRIVATE_MARKETS_ROUTING;
  const off = validateQuoteRequest(request);
  assert.equal(off.ok, false);
  assert.equal(off.ok === false && off.reason, "REPRESENTATION_RESTRICTED");
  process.env.HENAR_PRIVATE_MARKETS_ROUTING = "1";
  assert.equal(validateQuoteRequest(request).ok, rep.status === "ACTIVE");
  // A request naming one product may never resolve to another provider's product.
  const other = listRouterRepresentations().find((r) => r.assetClass === "PRIVATE_MARKET_EXPOSURE" && r.mint !== rep.mint);
  if (other) {
    const crossed = validateQuoteRequest({ ...request, outputMint: other.mint });
    assert.equal(crossed.ok, false);
    assert.equal(crossed.ok === false && crossed.reason, "INVALID_REQUEST");
    assert.equal(routerRepresentationForMint(other.mint)!.id, other.id);
  }
  delete process.env.HENAR_PRIVATE_MARKETS_ROUTING;
});

// --- transfer-fee guard --------------------------------------------------

const rep = publicRep;
const DEC = rep.decimals ?? 8;
function ranked(venue: Venue, pool: string): { quote: RankedQuote; registry: ReturnType<typeof buildPoolRegistry> } {
  const request: QuoteRequest = { representationId: rep.id, side: "buy", amount: "100000000", amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint };
  const swapIn = (BigInt(request.amount) - (BigInt(request.amount) * BigInt(MARKET_FEE_BPS)) / 10_000n).toString();
  const q: VenueQuote = { ...unavailableQuote(venue, request, "SDK_ERROR", null, pool, NOW), amountIn: swapIn, expectedAmountOut: (20n * 10n ** BigInt(DEC)).toString(), unavailableReason: null, unavailableDetail: null, priceImpactBps: 10, slot: SLOT, onchainCheckedAtQuote: true, executionPath: "none", expiresAt: new Date(NOW + 10_000).toISOString(), source: "fixture" };
  const programs: Record<string, string> = { meteora: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", "meteora-damm-v2": "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" };
  const poolRecord: VerifiedPool = {
    id: `${venue}:${pool}`, representationId: rep.id, mint: rep.mint, provider: rep.provider, tokenSymbol: rep.tokenSymbol, venue, address: pool, programId: programs[venue] ?? programs.meteora, poolType: venue === "meteora" ? "dlmm" : "damm_v2",
    baseMint: rep.mint, quoteMint: USDC_MINT, feeBps: 10, feeConfig: null, observedTokenPrograms: null, tvlUsd: 50_000, discoveredFrom: "fixture", discoveredAt: new Date(NOW).toISOString(), verifiedAt: new Date(NOW).toISOString(),
    verification: "ONCHAIN_VERIFIED", onchainVerifiedAt: new Date(NOW).toISOString(), verificationDetail: null, eligibility: "ROUTER_ELIGIBLE", dbc: null, enabled: true, disabledReason: null,
  };
  return { quote: rankQuote(q, request, MARKET_FEE_BPS), registry: buildPoolRegistry([poolRecord]) };
}

function withFee(bps: number | null) {
  // The guard reads the fee from the registry representation; patch it for the check.
  const original = rep.tokenExtensions;
  (rep as { tokenExtensions: unknown }).tokenExtensions = bps === null ? original : { scaledUiMultiplier: null, transferFeeBps: bps, readAt: new Date(NOW).toISOString() };
  return () => {
    (rep as { tokenExtensions: unknown }).tokenExtensions = original;
  };
}

test("a fee-bearing mint is admitted through a venue that quotes net of the fee and refused elsewhere", () => {
  const restore = withFee(20);
  try {
    const dlmm = ranked("meteora", key(41));
    const okVerdict = guardQuote(dlmm.quote, DEFAULT_EXECUTION_POLICY, { now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry: dlmm.registry });
    const feeCheck = okVerdict.checks.find((c) => c.name === "transferFee.accounted");
    assert.ok(feeCheck, "expected a transfer-fee check");
    assert.equal(feeCheck!.ok, true);
    assert.match(feeCheck!.detail, /20 bps netted by meteora/);

    const damm = ranked("meteora-damm-v2", key(42));
    const refused = guardQuote(damm.quote, DEFAULT_EXECUTION_POLICY, { now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry: damm.registry });
    const bad = refused.checks.find((c) => c.name === "transferFee.accounted")!;
    assert.equal(bad.ok, false);
    assert.equal(refused.approved, false);
    assert.equal(refused.reason, "UNSUPPORTED_TOKEN_EXTENSION");
    assert.match(bad.detail, /does not quote net of the 20 bps transfer fee/);
  } finally {
    restore();
  }
});

test("a zero-fee mint carries no transfer-fee check at all", () => {
  const restore = withFee(0);
  try {
    const { quote, registry } = ranked("meteora", key(41));
    const v = guardQuote(quote, DEFAULT_EXECUTION_POLICY, { now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry });
    assert.equal(v.checks.find((c) => c.name === "transferFee.accounted"), undefined);
  } finally {
    restore();
  }
});

test("the transfer-fee venue policy names only venues verified to quote net of the fee", () => {
  assert.deepEqual([...DEFAULT_EXECUTION_POLICY.transferFeeNetVenues].sort(), ["jupiter", "meteora", "orca", "raydium"]);
  assert.equal(DEFAULT_EXECUTION_POLICY.transferFeeNetVenues.includes("meteora-damm-v2" as Venue), false);
  assert.equal(DEFAULT_EXECUTION_POLICY.transferFeeNetVenues.includes("meteora-dbc" as Venue), false);
  assert.equal(TOKEN_2022_PROGRAM_ID.toBase58(), "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
});
