/**
 * FIXTURE: guard-approved quotes and plans for Tasks 13–18 tests. Every
 * address is derived (Buffer.alloc(32, n)); every amount is synthetic.
 */
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  USDC_MINT,
  buildPoolRegistry,
  listRouterRepresentations,
  rankQuote,
  unavailableQuote,
  type QuoteRequest,
  type RankedQuote,
  type Venue,
  type VenueQuote,
  type VerifiedPool,
} from "@henar/router-core";
import { DEFAULT_EXECUTION_POLICY, guardQuote, type GuardVerdict } from "@henar/execution-guard";
import { planExecution, type PlanInput } from "@henar/tx-builder";
import { MARKET_FEE_BPS } from "@/lib/trade-fee";

export const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
export const rep = listRouterRepresentations().find((r) => r.status === "ACTIVE")!;
export const DEC = rep.decimals ?? 8;
export const OWNER = key(100);
export const TREASURY = key(101);
export const NOW = 1_800_000_000_000;
export const SLOT = 300_000_000;
export const representation = { id: rep.id, provider: rep.provider, mint: rep.mint, decimals: DEC, tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58() };

export const buy = (amount = "100000000"): QuoteRequest => ({ representationId: rep.id, side: "buy", amount, amountType: "input", inputMint: USDC_MINT, outputMint: rep.mint });
export const sell = (amount = "1000000000"): QuoteRequest => ({ representationId: rep.id, side: "sell", amount, amountType: "input", inputMint: rep.mint, outputMint: USDC_MINT });

export function pool(venue: Venue, address: string, overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  const poolType = venue === "raydium" ? "clmm" : venue === "meteora" ? "dlmm" : venue === "meteora-dbc" ? "dbc" : "damm_v2";
  return {
    id: `${venue}:${address}`, representationId: rep.id, mint: rep.mint, provider: rep.provider, tokenSymbol: rep.tokenSymbol, venue, address, programId: key(50), poolType,
    baseMint: rep.mint, quoteMint: USDC_MINT, feeBps: 10, feeConfig: null, observedTokenPrograms: null, tvlUsd: 50_000, discoveredFrom: "fixture", discoveredAt: "2026-09-15T00:00:00.000Z",
    verifiedAt: "2026-09-15T00:00:00.000Z", verification: "ONCHAIN_VERIFIED", onchainVerifiedAt: "2026-09-15T00:00:00.000Z", verificationDetail: null, eligibility: "ROUTER_ELIGIBLE",
    dbc: null, enabled: true, disabledReason: null, ...overrides,
  };
}

export function quoteFor(venue: Venue, request: QuoteRequest, out: bigint, poolAddress: string, extra: Partial<VenueQuote> = {}): RankedQuote {
  const swapIn = request.side === "buy" ? (BigInt(request.amount) - (BigInt(request.amount) * BigInt(MARKET_FEE_BPS)) / 10_000n).toString() : request.amount;
  const q: VenueQuote = {
    ...unavailableQuote(venue, request, "SDK_ERROR", null, poolAddress, NOW),
    amountIn: swapIn, expectedAmountOut: out.toString(), unavailableReason: null, unavailableDetail: null, priceImpactBps: 10, slot: SLOT,
    onchainCheckedAtQuote: true, executionPath: "none", expiresAt: new Date(NOW + 10_000).toISOString(), source: `${venue}:fixture`, ...extra,
  };
  return rankQuote(q, request, MARKET_FEE_BPS);
}

export function approve(quote: RankedQuote, pools: VerifiedPool[]): GuardVerdict {
  const v = guardQuote(quote, DEFAULT_EXECUTION_POLICY, { now: NOW, currentSlot: SLOT + 1, reference: null, representationDecimals: DEC, registry: buildPoolRegistry(pools) });
  if (!v.approved) throw new Error(`fixture quote not approved: ${v.reason} ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
  return v;
}

export const SHARES = (n: bigint) => n * 10n ** BigInt(DEC);

/** A single-leg buy plan: 100 USDC → 20 shares on Raydium. */
export function singleBuyPlan(overrides: Partial<PlanInput> = {}) {
  const pools = [pool("raydium", key(1))];
  const verdict = approve(quoteFor("raydium", buy(), SHARES(20n), key(1)), pools);
  return planExecution({ representation, side: "buy", owner: OWNER, treasuryOwner: TREASURY, userInput: 100_000_000n, legs: [{ verdict }], policy: DEFAULT_EXECUTION_POLICY, registry: buildPoolRegistry(pools), now: NOW, ...overrides });
}

/** A two-leg split sell plan: 10 shares → USDC across Raydium and Meteora DLMM. */
export function splitSellPlan() {
  const pools = [pool("raydium", key(1)), pool("meteora", key(2))];
  const a = approve(quoteFor("raydium", sell("600000000"), 30_000_000n, key(1)), pools);
  const b = approve(quoteFor("meteora", sell("400000000"), 20_000_000n, key(2)), pools);
  return planExecution({ representation, side: "sell", owner: OWNER, treasuryOwner: TREASURY, userInput: 1_000_000_000n, legs: [{ verdict: a }, { verdict: b }], policy: DEFAULT_EXECUTION_POLICY, registry: buildPoolRegistry(pools), now: NOW });
}
