/**
 * Two-leg paths through a qualified intermediate, on FIXTURE curves.
 *
 * The representation has a thin USDC pool and a deep SOL pool; SOL has a deep
 * USDC pool. The path (USDC → SOL → representation) must beat the direct
 * quote, be sized on the first hop's floor, report the residual, and account
 * the Henar fee exactly once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  USDC_MINT,
  constantProductCurve,
  intermediateRepresentationId,
  listRouterRepresentations,
  qualifiedIntermediates,
  quoteRepresentation,
  unavailableQuote,
  type QuoteRequest,
  type VenueAdapter,
  type VenueCurve,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";
import { tradeFee } from "@/lib/trade-fee";

const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
const SOL = "So11111111111111111111111111111111111111112";
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const buy = (amount: string): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint });
const sell = (amount: string): QuoteRequest => ({ representationId: rep.id, side: "sell", amount, amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT });

/** A pool's curve in either direction, keyed by input mint. */
type Pool = { address: string; a: string; b: string; reserveA: bigint; reserveB: bigint };
function curveFor(p: Pool, inputMint: string): VenueCurve | null {
  if (inputMint === p.a) return constantProductCurve("raydium", p.address, p.reserveA, p.reserveB, 10);
  if (inputMint === p.b) return constantProductCurve("raydium", p.address, p.reserveB, p.reserveA, 10);
  return null;
}
function quoteFrom(curve: VenueCurve, request: QuoteRequest, amountIn: bigint): VenueQuote {
  const out = curve.outputFor(amountIn);
  const base = unavailableQuote("raydium", request, "INSUFFICIENT_LIQUIDITY", null, curve.poolAddress);
  if (out === null) return base;
  return { ...base, amountIn: amountIn.toString(), expectedAmountOut: out.toString(), unavailableReason: null, unavailableDetail: null, slot: 1, priceImpactBps: 5, onchainCheckedAtQuote: true, source: "fixture", executionPath: "henar-native" };
}
function adapter(pools: Pool[]): VenueAdapter {
  const find = (address: string) => pools.find((p) => p.address === address);
  return {
    venue: "raydium",
    capabilities: () => ({ venue: "raydium", quote: true, legacyExecution: false, nativeBuild: true, poolTypes: ["clmm"], supportsMinOut: true, supportsToken2022: true }),
    health: async () => ({ venue: "raydium", healthy: true, checkedAt: "", detail: null }),
    getQuote: async (r, ctx) => {
      const p = ctx.pools[0] && find(ctx.pools[0].address);
      const c = p && curveFor(p, r.inputMint);
      return c ? quoteFrom(c, r, BigInt(r.amount)) : unavailableQuote("raydium", r, "NO_VERIFIED_POOL");
    },
    curve: async (r, pool) => {
      const p = find(pool.address);
      const c = p && curveFor(p, r.inputMint);
      return c ? { ...c, quoteFor: (amt: bigint) => quoteFrom(c, r, amt) } : null;
    },
    buildSwapInstructions: async () => ({ instructions: [], lookupTables: [], reason: "NOT_IMPLEMENTED", detail: null }),
  };
}
const record = (address: string, mint: string, representationId: string, baseMint: string, quoteMint: string, eligibility: VerifiedPool["eligibility"]): VerifiedPool => ({
  id: address, representationId, mint, provider: rep.provider, tokenSymbol: rep.tokenSymbol, venue: "raydium", address, programId: key(50), poolType: "clmm", baseMint, quoteMint, feeBps: 10, feeConfig: null, observedTokenPrograms: null, tvlUsd: 1e6, discoveredFrom: "f", discoveredAt: "", verifiedAt: "", verification: "ONCHAIN_VERIFIED", onchainVerifiedAt: "x", verificationDetail: null, eligibility, dbc: null, enabled: true, disabledReason: null,
});

// Prices: 1 share = 100 USDC = 1 SOL at 100 USDC/SOL. Amounts: USDC 6dp, SOL 9dp, share 6dp.
const USDC = (n: bigint) => n * 1_000_000n;
const LAMPORTS = (n: bigint) => n * 1_000_000_000n;
const direct: Pool = { address: key(1), a: USDC_MINT, b: rep.mint, reserveA: USDC(20_000n), reserveB: 200n * 1_000_000n }; // thin: $20k
const solLeg: Pool = { address: key(2), a: SOL, b: rep.mint, reserveA: LAMPORTS(20_000n), reserveB: 20_000n * 1_000_000n }; // deep: $2m
const solUsdc: Pool = { address: key(3), a: USDC_MINT, b: SOL, reserveA: USDC(50_000_000n), reserveB: LAMPORTS(500_000n) }; // $100m
const registryPools = [record(key(1), rep.mint, rep.id, rep.mint, USDC_MINT, "ROUTER_ELIGIBLE"), record(key(2), rep.mint, rep.id, SOL, rep.mint, "ROUTING_LEG")];
const solPools = [record(key(3), SOL, intermediateRepresentationId(SOL), USDC_MINT, SOL, "INTERMEDIATE_ROUTE")];

test("SOL is a qualified intermediate in the committed universe", () => {
  assert.ok(qualifiedIntermediates().some((a) => a.mint === SOL));
});

test("buy: the path through SOL beats a thin direct pool, is sized on the first hop floor, and reports the residual", async () => {
  const a = adapter([direct, solLeg, solUsdc]);
  const amount = USDC(1_000n).toString();
  const result = await quoteRepresentation(buy(amount), { adapters: [a], enabled: true, splitRouting: true, poolsOverride: registryPools, intermediatePoolsOverride: solPools, pathFloors: { intermediateHopBps: 10, representationHopBps: () => 30 } });
  assert.ok(result.best, "direct quote expected");
  assert.ok(result.path, `path expected: ${result.pathReason}`);
  const path = result.path;
  assert.equal(path.kind, "path");
  assert.equal(path.legs.length, 2);
  assert.equal(path.intermediate?.mint, SOL);
  const [first, second] = path.legs;
  assert.equal(first.inputMint, USDC_MINT);
  assert.equal(first.outputMint, SOL);
  assert.equal(second.inputMint, SOL);
  assert.equal(second.outputMint, rep.mint);
  // Fee once, on the USDC input of the first hop.
  const fee = tradeFee(BigInt(amount));
  assert.equal(first.fees.henarInputFee, fee.toString());
  assert.equal(first.fees.venueInput, (BigInt(amount) - fee).toString());
  assert.equal(second.fees.henarInputFee, "0");
  assert.equal(path.fees.henarInputFee, fee.toString());
  // The second hop is fed the first hop's floor, 10 bps under its expected output.
  const aOut = BigInt(first.expectedAmountOut);
  const aFloor = aOut - (aOut * 10n) / 10_000n;
  assert.equal(second.amountIn, aFloor.toString());
  assert.equal(path.residual?.expected, (aOut - aFloor).toString());
  assert.equal(path.residual?.mint, SOL);
  // Net output is the second hop's output and beats the thin direct pool.
  assert.equal(path.netOutput, second.expectedAmountOut);
  assert.ok(BigInt(path.netOutput) > BigInt(result.best.netOutput), "path should beat the thin direct pool");
  assert.ok((path.improvementBps ?? 0) > 0);
});

test("sell: the path sells into SOL, converts the floor to USDC, and takes the fee on the USDC output", async () => {
  const a = adapter([direct, solLeg, solUsdc]);
  const amount = (10n * 1_000_000n).toString(); // 10 shares
  const result = await quoteRepresentation(sell(amount), { adapters: [a], enabled: true, splitRouting: true, poolsOverride: registryPools, intermediatePoolsOverride: solPools, pathFloors: { intermediateHopBps: 10, representationHopBps: () => 30 } });
  assert.ok(result.path, `path expected: ${result.pathReason}`);
  const [first, second] = result.path.legs;
  assert.equal(first.inputMint, rep.mint);
  assert.equal(first.outputMint, SOL);
  assert.equal(second.inputMint, SOL);
  assert.equal(second.outputMint, USDC_MINT);
  const bOut = BigInt(first.expectedAmountOut);
  const bFloor = bOut - (bOut * 30n) / 10_000n;
  assert.equal(second.amountIn, bFloor.toString());
  assert.equal(result.path.residual?.expected, (bOut - bFloor).toString());
  const gross = BigInt(second.expectedAmountOut);
  const fee = tradeFee(gross);
  assert.equal(second.fees.henarOutputFee, fee.toString());
  assert.equal(result.path.netOutput, (gross - fee).toString());
  assert.equal(first.fees.henarOutputFee, "0");
});

test("no path without an intermediate USDC pool, and the reason says so", async () => {
  const a = adapter([direct, solLeg, solUsdc]);
  const result = await quoteRepresentation(buy(USDC(1_000n).toString()), { adapters: [a], enabled: true, splitRouting: true, poolsOverride: registryPools, intermediatePoolsOverride: [] });
  assert.equal(result.path, null);
  assert.match(result.pathReason ?? "", /no USDC pool for the intermediate/);
});

test("path routing can be switched off", async () => {
  const a = adapter([direct, solLeg, solUsdc]);
  const result = await quoteRepresentation(buy(USDC(1_000n).toString()), { adapters: [a], enabled: true, splitRouting: true, pathRouting: false, poolsOverride: registryPools, intermediatePoolsOverride: solPools });
  assert.equal(result.path, null);
  assert.equal(result.pathReason, "path routing is off");
});
