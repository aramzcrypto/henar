/**
 * Issuer intelligence, offline.
 *
 * The rule under test throughout is that a figure never outruns its source: a
 * catalog count comes from the registry, a market total from the market pass,
 * a backing ratio from the issuer's own reserve record, and an issuer with no
 * readable source reports why rather than a zero.
 *
 * Fixtures mirror the live payloads read on 20 September 2026.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { equityRegistry } from "../src/lib/equities/registry";
import {
  chunk,
  parseSearchPayload,
  readMarketEntries,
  tradedVolume,
  type CatalogMarket,
  type TokenMarketEntry,
} from "../src/lib/equities/catalog-market";
import {
  activityIndex,
  companyActivity,
  passesLiquidity,
  LIQUID_FLOOR_USD,
} from "../src/lib/equities/onchain-activity";
import { issuerCatalog, issuerProfile, issuerRepresentations, tokenSuffix } from "../src/lib/issuers/profiles";
import { aggregateIssuerMarket } from "../src/lib/issuers/market";
import { backingRatio, summarizeAssets, summarizeReserves } from "../src/lib/issuers/providers/xstocks";
import { summarizeBackpack, tokenizedSecurities } from "../src/lib/issuers/providers/backpack";
import { ondoDisclosure, summarizeOndo } from "../src/lib/issuers/providers/ondo";
import type { BackpackSnapshot } from "../src/lib/equities/providers/backpack-primary";
import { ISSUER_IDS } from "../src/lib/issuers/types";
import { PublicKey } from "@solana/web3.js";
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { chunkMints, supplyFromAccount, supplyToNumber } from "../src/lib/equities/mint-supply";

const AT = "2026-09-20T07:00:00.000Z";

function equityForMintTicker(mint: string) {
  const equity = equityRegistry.find((item) => item.representations.some((r) => r.mint === mint));
  if (!equity) throw new Error(`no company for ${mint}`);
  return equity.ticker;
}

function marketOf(entries: TokenMarketEntry[], complete = true): CatalogMarket {
  return {
    entries: new Map(entries.map((entry) => [entry.id, entry])),
    observedAt: AT,
    complete,
    batches: 1,
    failedBatches: complete ? 0 : 1,
  };
}

test("issuer identity is derived from the verified catalog, never restated", () => {
  const xstocks = issuerProfile("xstocks")!;
  assert.equal(xstocks.label, "xStocks");
  assert.equal(xstocks.issuer, "Backed Assets (JE) Limited");
  assert.equal(xstocks.tokenSuffix, "x");
  assert.equal(issuerProfile("ondo")!.tokenSuffix, "on");
  // Backpack publishes the plain ticker, so there is no suffix to claim.
  assert.equal(issuerProfile("backpack")!.tokenSuffix, "");
  // The suffix is measured, so a catalog of one token decides it.
  assert.equal(tokenSuffix([{ tokenSymbol: "NVDAx", equityId: "equity:NVDA" }]), "x");
  assert.equal(tokenSuffix([{ tokenSymbol: "NVDA", equityId: "equity:NVDA" }]), "");
});

test("catalog scale per issuer adds up to the whole verified registry", () => {
  const representations = ISSUER_IDS.reduce((total, id) => total + issuerCatalog(id).representations, 0);
  assert.equal(representations, 2_212);
  assert.equal(
    representations,
    equityRegistry.reduce((total, equity) => total + equity.representations.length, 0),
  );
  // Companies only one issuer represents: the measured split on this catalog.
  assert.equal(issuerCatalog("backpack").soleIssuer, 397);
  assert.equal(issuerCatalog("xstocks").soleIssuer, 176);
  assert.equal(issuerCatalog("ondo").soleIssuer, 84);
  for (const id of ISSUER_IDS)
    assert.equal(issuerCatalog(id).representations, issuerRepresentations(id).length);
});

test("market payloads: malformed rows are dropped, and volume needs a reported side", () => {
  const parsed = parseSearchPayload([
    { id: "mint-a", usdPrice: 10, liquidity: 5, stats24h: { buyVolume: 1, sellVolume: 2 } },
    { id: 42 },
    { nonsense: true },
    null,
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "mint-a");
  assert.equal(parseSearchPayload({ not: "an array" }).length, 0);
  assert.equal(tradedVolume({ id: "a", stats24h: { buyVolume: 3, sellVolume: 4 } }), 7);
  assert.equal(tradedVolume({ id: "a", stats24h: { buyVolume: 3 } }), 3);
  // No stats at all is unknown, which is not the same as zero traded.
  assert.equal(tradedVolume({ id: "a" }), null);
  assert.equal(tradedVolume(undefined), null);
  assert.equal(chunk([1, 2, 3, 4, 5], 2).length, 3);
});

test("a failed batch is recorded rather than swallowed or retried into a stall", async () => {
  const calls: string[] = [];
  const stub = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 2) return new Response("rate limited", { status: 429 });
    return Response.json([{ id: "mint-a", usdPrice: 1 }]);
  }) as typeof fetch;
  const mints = Array.from({ length: 150 }, (_, index) => `mint-${index}`);
  const result = await readMarketEntries(mints, { fetch: stub, concurrency: 1 });
  assert.equal(result.batches, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.entries.size, 1);
});

test("issuer market totals are reported beside the mints they came from", () => {
  const ondo = issuerRepresentations("ondo").slice(0, 3);
  const market = marketOf([
    { id: ondo[0].mint, usdPrice: 100, liquidity: 50_000, holderCount: 10, stats24h: { buyVolume: 400, sellVolume: 600, numTraders: 7 } },
    { id: ondo[1].mint, usdPrice: 50, liquidity: 1_000, holderCount: 5 },
  ]);
  const aggregate = aggregateIssuerMarket("ondo", market);
  assert.equal(aggregate.status, "available");
  assert.equal(aggregate.mintsQueried, issuerRepresentations("ondo").length);
  assert.equal(aggregate.mintsWithMarket, 2);
  assert.equal(aggregate.pricedMints, 2);
  // Only one mint reported a traded side, so only one counts as traded.
  assert.equal(aggregate.tradedMints, 1);
  assert.equal(aggregate.volume24hUsd, 1_000);
  assert.equal(aggregate.liquidityUsd, 51_000);
  assert.equal(aggregate.holders, 15);
  assert.equal(aggregate.traders24h, 7);
  assert.equal(aggregate.top[0].mint, ondo[0].mint);
  assert.equal(aggregate.reason, null);
});

test("an issuer with no market read says so, and a short pass admits it is short", () => {
  const empty = aggregateIssuerMarket("xstocks", marketOf([]));
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.volume24hUsd, null);
  assert.match(empty.reason!, /returned nothing/);
  const partial = aggregateIssuerMarket(
    "ondo",
    marketOf([{ id: issuerRepresentations("ondo")[0].mint, usdPrice: 1 }], false),
  );
  assert.match(partial.reason!, /could not be read/);
});

test("liquid means traded with depth behind it, and the floor is a stated number", () => {
  const nvidia = equityRegistry.find((equity) => equity.ticker === "NVDA")!;
  const thin = nvidia.representations[0].mint;
  const deep = nvidia.representations[1].mint;
  const index = activityIndex(
    marketOf([
      { id: thin, liquidity: LIQUID_FLOOR_USD - 1, stats24h: { buyVolume: 10, sellVolume: 10 } },
      { id: deep, liquidity: LIQUID_FLOOR_USD, stats24h: { buyVolume: 5, sellVolume: 5 } },
    ]),
    [nvidia],
  );
  const activity = index.byTicker.get("NVDA")!;
  assert.equal(activity.tradedMints, 2);
  assert.equal(activity.liquidMints, 1);
  assert.equal(activity.volume24hUsd, 30);
  assert.ok(passesLiquidity(activity, "traded"));
  assert.ok(passesLiquidity(activity, "liquid"));

  // Depth with no trade is not a liquid market, and neither is a missing read.
  const idle = activityIndex(marketOf([{ id: deep, liquidity: 1_000_000 }]), [nvidia]);
  assert.equal(idle.byTicker.get("NVDA")!.tradedMints, 0);
  assert.equal(passesLiquidity(idle.byTicker.get("NVDA"), "traded"), false);
  assert.equal(passesLiquidity(idle.byTicker.get("NVDA"), "liquid"), false);
  assert.equal(passesLiquidity(undefined, "traded"), false);
});

test("a partial market read may reorder but must never exclude", () => {
  const nvidia = equityRegistry.find((equity) => equity.ticker === "NVDA")!;
  const partial = marketOf(
    [{ id: nvidia.representations[0].mint, liquidity: 500_000, stats24h: { buyVolume: 50, sellVolume: 50 } }],
    false,
  );
  const index = activityIndex(partial, [nvidia]);
  // The company that was read looks liquid, and on its own would pass.
  assert.ok(passesLiquidity(index.byTicker.get("NVDA"), "liquid"));
  /* But the pass is short, so a company whose batch failed is indistinguishable
     from one with no market. The route refuses to filter on this, and the
     index says why: an upstream rate limit must not read as "nothing is
     liquid anywhere". */
  assert.equal(index.complete, false);
  assert.equal(activityIndex(marketOf([]), [nvidia]).complete, true);
});

test("with an issuer selected, liquidity answers about that issuer's token", () => {
  const nvidia = equityRegistry.find((equity) => equity.ticker === "NVDA")!;
  const xstocks = nvidia.representations.find((item) => item.provider === "xstocks")!;
  const ondo = nvidia.representations.find((item) => item.provider === "ondo")!;
  /* The xStocks token is deep and trading; the Ondo token has no market. A
     reader filtered to Ondo must not be shown NVIDIA as liquid. */
  const market = marketOf([
    { id: xstocks.mint, liquidity: 2_000_000, stats24h: { buyVolume: 5_000, sellVolume: 5_000 } },
    { id: ondo.mint, liquidity: 0 },
  ]);
  assert.ok(passesLiquidity(activityIndex(market, [nvidia]).byTicker.get("NVDA"), "liquid"));
  assert.ok(passesLiquidity(activityIndex(market, [nvidia], "xstocks").byTicker.get("NVDA"), "liquid"));
  const scoped = activityIndex(market, [nvidia], "ondo").byTicker.get("NVDA")!;
  assert.equal(passesLiquidity(scoped, "liquid"), false);
  assert.equal(passesLiquidity(scoped, "traded"), false);
  assert.equal(scoped.representations, 1);
  // Volume is the issuer's own, not the company's across every issuer.
  assert.equal(activityIndex(market, [nvidia], "xstocks").byTicker.get("NVDA")!.volume24hUsd, 10_000);
  assert.equal(scoped.volume24hUsd, null);
});

test("a caller supplying its own fetch is never served another caller's pass", async () => {
  const entry = (id: string) => Response.json([{ id, usdPrice: 1, liquidity: 1, stats24h: { buyVolume: 1, sellVolume: 1 } }]);
  const first = issuerRepresentations("xstocks")[0].mint;
  const second = issuerRepresentations("ondo")[0].mint;
  let calls = 0;
  const stubA = (async () => {
    calls += 1;
    return entry(first);
  }) as typeof fetch;
  const stubB = (async () => {
    calls += 1;
    return entry(second);
  }) as typeof fetch;
  const a = await companyActivity({ fetch: stubA });
  const callsAfterA = calls;
  const b = await companyActivity({ fetch: stubB });
  assert.ok(calls > callsAfterA, "the second caller must read rather than reuse the first's entries");
  assert.equal(a.byTicker.get(equityForMintTicker(first))!.tradedMints, 1);
  assert.equal(b.byTicker.get(equityForMintTicker(first))!.tradedMints, 0);
});

test("xStocks reserves: ratio needs tokens outstanding, and custodians are counted", () => {
  const reserves = [
    { symbol: "NVDAx", timestamp: "2026-09-20T07:03:14.043Z", sharesHeld: "185727.24", circulatingSupply: "185490.81", holdings: [{ provider: "Alpaca" }] },
    { symbol: "SHORTx", timestamp: "2026-09-20T06:00:00.000Z", sharesHeld: "90", circulatingSupply: "100", holdings: [{ provider: "Gtn" }] },
    // No tokens outstanding: a ratio here would divide by zero, so it is skipped.
    { symbol: "IDLEx", sharesHeld: "10", circulatingSupply: "0", holdings: [{ provider: "Alpaca" }] },
  ];
  const summary = summarizeReserves(reserves);
  assert.equal(summary.status, "available");
  assert.equal(summary.assets, 3);
  assert.equal(summary.comparable, 2);
  assert.equal(summary.fullyBacked, 1);
  assert.ok(summary.minRatio! < 1);
  assert.deepEqual(
    summary.custodians.map((custodian) => custodian.name),
    ["Alpaca", "Gtn"],
  );
  assert.equal(summary.observedAt, "2026-09-20T07:03:14.043Z");
  assert.equal(backingRatio({ symbol: "x", sharesHeld: "10", circulatingSupply: "0" }), null);
  assert.equal(backingRatio({ symbol: "x", sharesHeld: "nonsense", circulatingSupply: "5" }), null);
  assert.equal(summarizeReserves([]).status, "unavailable");
});

test("xStocks catalog is matched on the published address, never on a symbol", () => {
  const real = issuerRepresentations("xstocks")[0];
  const assets = [
    {
      symbol: real.tokenSymbol,
      isTradingHalted: false,
      trading: { tradingHoursMode: "TwentyFourFive", exchange: { abbreviation: "NASDAQ" } },
      deployments: [
        { address: real.mint, network: "Solana" },
        { address: "0xabc", network: "Ethereum" },
      ],
    },
    {
      // Right symbol shape, an address Henar has never verified: not a match.
      symbol: real.tokenSymbol,
      isTradingHalted: true,
      trading: { tradingHoursMode: "MarketHours", exchange: { abbreviation: "LSE" } },
      deployments: [{ address: "NotAVerifiedMint1111111111111111111111111", network: "Solana" }],
    },
  ];
  const { measures, networks } = summarizeAssets(
    assets,
    [{ symbol: real.tokenSymbol, network: "Solana", managedBy: "Pyth" }],
    new Set([real.mint]),
  );
  const value = (id: string) => measures.find((measure) => measure.id === id)!.value;
  assert.equal(value("catalogAssets"), 2);
  assert.equal(value("solanaAssets"), 2);
  assert.equal(value("henarVerified"), 1);
  assert.equal(value("halted"), 1);
  assert.equal(value("tradingHours"), 1);
  assert.equal(value("oracles"), 1);
  assert.deepEqual(networks, ["Solana", "Ethereum"]);
});

test("Backpack: a listing is not a token, and a token is not necessarily movable", () => {
  const real = issuerRepresentations("backpack")[0];
  const snapshot: BackpackSnapshot = {
    assets: [
      {
        symbol: "NVDA.US",
        tokens: [
          { blockchain: "Solana", contractAddress: real.mint, depositEnabled: true, withdrawEnabled: true },
          { blockchain: "Ethereum", contractAddress: "0xabc", depositEnabled: true, withdrawEnabled: true },
        ],
      },
      {
        symbol: "GATED.US",
        tokens: [{ blockchain: "Solana", contractAddress: "GatedMint111111111111111111111111111111111", depositEnabled: false, withdrawEnabled: false }],
      },
      // Listed as an asset but not as a security: never a tokenized security.
      { symbol: "SOL", tokens: [{ blockchain: "Solana", contractAddress: "So11111111111111111111111111111111111111112", depositEnabled: true, withdrawEnabled: true }] },
    ],
    securities: [
      { asset: "NVDA.US", sessions: [{ name: "US_EQUITIES_REGULAR" }, { name: "US_EQUITIES_PRE_MARKET" }] },
      { asset: "GATED.US", sessions: [{ name: "US_EQUITIES_REGULAR" }] },
    ],
    markets: [
      { baseSymbol: "NVDA.US", quoteSymbol: "USDC", marketType: "SPOT", symbol: "NVDA.US_USDC", orderBookState: "Open" },
      { baseSymbol: "NVDA.US", quoteSymbol: "USDC", marketType: "PERP", symbol: "NVDA.US_USDC_PERP", orderBookState: "Open" },
      { baseSymbol: "SOL", quoteSymbol: "USDC", marketType: "SPOT", symbol: "SOL_USDC", orderBookState: "Open" },
    ],
    checkedAt: AT,
  };
  assert.equal(tokenizedSecurities(snapshot).length, 2);
  const measures = summarizeBackpack(snapshot, new Set([real.mint]));
  const value = (id: string) => measures.find((measure) => measure.id === id)!.value;
  assert.equal(value("catalogAssets"), 2);
  assert.equal(value("solanaAssets"), 2);
  assert.equal(value("henarVerified"), 1);
  assert.equal(value("onchainWithdraw"), 1);
  assert.equal(value("onchainDeposit"), 1);
  // The unrelated SOL market must not be counted against the securities.
  assert.equal(value("exchangeSpot"), 1);
  assert.equal(value("exchangePerp"), 1);
  assert.equal(value("sessions"), 2);
});

test("Ondo without a key reports why, and never a zero", async () => {
  const disclosure = await ondoDisclosure({ apiKey: null });
  assert.equal(disclosure.status, "not_configured");
  assert.equal(disclosure.measures.length, 0);
  assert.match(disclosure.reason!, /requires a key/);
  assert.match(disclosure.reason!, /ONDO_API_KEY/);
});

test("Ondo with a key maps its published addresses to verified mints", () => {
  const real = issuerRepresentations("ondo")[0];
  const measures = summarizeOndo(
    [{ symbol: "NVDAon", assetClass: "equity" }, { symbol: "SPYon", assetClass: "etf" }],
    [
      { symbol: "NVDAon", addresses: [{ chainId: "solana", address: real.mint }, { chainId: "1", address: "0xabc" }] },
      { symbol: "SPYon", addresses: [{ chainId: "solana", address: "UnverifiedMint11111111111111111111111111" }] },
    ],
    true,
    new Set([real.mint]),
  );
  const value = (id: string) => measures.find((measure) => measure.id === id)!.value;
  assert.equal(value("catalogAssets"), 2);
  assert.equal(value("solanaAssets"), 3);
  assert.equal(value("henarVerified"), 1);
  assert.equal(value("networks"), 2);
  assert.equal(value("assetClasses"), 2);
  assert.equal(value("marketStatus"), "Open");
  assert.equal(summarizeOndo([], [], null, new Set()).find((m) => m.id === "marketStatus")!.value, null);
});

test("supply separates an issued token from a registered address", () => {
  /* Backpack publishes a Solana address for more than a thousand securities,
     but a token exists only once someone withdraws an entitlement. Sampled
     against mainnet on 21 September 2026, 5.5% of its mints held any supply;
     xStocks was at 100% and Ondo at 94%. A catalog count cannot see that, and
     neither can AMM liquidity: it cannot tell a token nobody trades from a
     token that does not exist. */
  const mint = (supply: bigint, decimals: number, program = TOKEN_PROGRAM_ID) => {
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply,
        decimals,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    return { owner: program, data, executable: false, lamports: 1, rentEpoch: 0 };
  };

  const issued = supplyFromAccount("A", mint(321_571_164_500n, 8));
  assert.equal(issued.live, true);
  assert.ok(Math.abs(issued.supply! - 3215.711645) < 1e-6);

  // A registered address nobody has withdrawn against.
  const empty = supplyFromAccount("B", mint(0n, 6));
  assert.equal(empty.live, false);
  assert.equal(empty.supply, 0);

  // An account we could not read is unknown, never empty.
  const missing = supplyFromAccount("C", null);
  assert.equal(missing.live, null);
  assert.equal(missing.supply, null);

  // The scaled-UI multiplier is part of the displayed supply, not decoration.
  assert.equal(supplyToNumber(1_000_000n, 6, null), 1);
  assert.equal(supplyToNumber(1_000_000n, 6, "1"), 1);
  assert.ok(Math.abs(supplyToNumber(1_000_000n, 6, "1.0009180758490996")! - 1.0009180758) < 1e-9);
  assert.equal(supplyToNumber(1_000_000n, 6, "not-a-number"), 1);

  // Batching matches what getMultipleAccounts will accept.
  assert.equal(chunkMints(new Array(250).fill("m")).length, 3);
  assert.equal(chunkMints([]).length, 0);
});
