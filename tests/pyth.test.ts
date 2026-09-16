/**
 * Pyth Pro layer, offline: catalog normalization, verified feed mapping,
 * latest-price normalization (freshness from feedUpdateTimestamp, never from
 * the presence of a price), the fair-value engine, history normalization and
 * error classification. Fixtures mirror the live catalog rows read on
 * 16 September 2026.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { equityForTicker } from "../src/lib/equities/registry";
import { catalogFromPayload } from "../src/lib/pyth/catalog";
import { resolveCompanyFeeds, resolveUnderlyingFeed } from "../src/lib/pyth/feeds";
import { classifyStatus, notEntitledFeedIds } from "../src/lib/pyth/client";
import { spreadSample } from "../src/lib/pyth/coverage";
import { availabilityFromError, freshnessOf, normalizeReference } from "../src/lib/pyth/price";
import { assessFairValue, executablePriceFrom, guardStateOf } from "../src/lib/pyth/fair-value";
import { candlesFromPayload, clampRange } from "../src/lib/pyth/history";
import { parseDecimal, ratioBps, relativeBps, scaleMantissa } from "../src/lib/pyth/decimal-math";
import { PYTH_QUALITY } from "../src/lib/pyth/config";
import type { PythReference } from "../src/lib/pyth/types";
import { henarFlag, pythGuardMode } from "../src/lib/feature-flags";

const row = (o: Record<string, unknown>) => ({
  pyth_lazer_id: 0, name: "", symbol: "", description: "", asset_type: "crypto", instrument_type: "spot", exponent: -8, min_channel: "fixed_rate@200ms", state: "stable",
  hermes_id: "ab", quote_currency: "USD", market_sessions: { regular: {} }, schedule: null, ...o,
});
const CATALOG = [
  row({ pyth_lazer_id: 1314, name: "NVDA", symbol: "Equity.US.NVDA/USD", description: "NVIDIA CORP / US DOLLAR", asset_type: "equity", exponent: -5, min_channel: "fixed_rate@50ms", market_sessions: { regular: {}, pre_market: {}, post_market: {}, over_night: {} } }),
  row({ pyth_lazer_id: 1833, name: "NVDAXUSD", symbol: "Crypto.NVDAX/USD", description: "NVIDIA XSTOCK / US DOLLAR" }),
  row({ pyth_lazer_id: 1832, name: "NVDAXNVDA", symbol: "Crypto.NVDAX/NVDA.RR", description: "NVIDIA XSTOCK / NVIDIA REDEMPTION RATE", asset_type: "crypto-redemption-rate", instrument_type: "rate" }),
  row({ pyth_lazer_id: 3127, name: "NVDAONUSD", symbol: "Crypto.NVDAON/USD", description: "NVIDIA ONDO TOKENIZED STOCK / US DOLLAR" }),
  // A look-alike that must never map: right symbol shape, wrong issuer.
  row({ pyth_lazer_id: 9001, name: "AAPLXUSD", symbol: "Crypto.AAPLX/USD", description: "SOME OTHER TOKEN / US DOLLAR" }),
  row({ pyth_lazer_id: 9002, name: "AAPL", symbol: "Equity.US.AAPL/USD", description: "APPLE / US DOLLAR", asset_type: "equity", exponent: -5 }),
  { garbage: true },
];

test("catalog normalization keeps only verified fields and drops malformed rows", () => {
  const catalog = catalogFromPayload(CATALOG, "2026-09-16T00:00:00.000Z");
  assert.equal(catalog.entries.length, 6);
  const nvda = catalog.byId.get(1314)!;
  assert.equal(nvda.symbol, "Equity.US.NVDA/USD");
  assert.deepEqual(nvda.sessions, ["regular", "pre_market", "post_market", "over_night"]);
  assert.equal(catalog.bySymbol.get("EQUITY.US.NVDA/USD")?.feedId, 1314);
});

test("feed mapping: underlying, xStocks via issuer keyword + redemption rate, Ondo via issuer keyword, Backpack unmapped", () => {
  const catalog = catalogFromPayload(CATALOG);
  const nvidia = equityForTicker("NVDA")!;
  const feeds = resolveCompanyFeeds(nvidia, catalog);
  assert.equal(feeds.underlying?.feedId, 1314);
  assert.ok(feeds.underlying?.evidence.includes("asset_type equity"));
  const x = nvidia.representations.find((r) => r.provider === "xstocks")!;
  const o = nvidia.representations.find((r) => r.provider === "ondo")!;
  const b = nvidia.representations.find((r) => r.provider === "backpack")!;
  assert.equal(feeds.tokenized[x.id]?.feedId, 1833);
  assert.ok(feeds.tokenized[x.id].evidence.some((e) => /redemption-rate feed Crypto.NVDAX\/NVDA.RR/.test(e)));
  assert.ok(feeds.tokenized[x.id].evidence.some((e) => /symbol names the issuer token NVDAx/.test(e)));
  assert.equal(feeds.redemptionRates[x.id]?.feedId, 1832);
  assert.equal(feeds.tokenized[o.id]?.feedId, 3127);
  assert.equal(feeds.redemptionRates[o.id], undefined);
  assert.equal(feeds.tokenized[b.id], undefined);
  assert.match(feeds.unmapped.find((u) => u.representationId === b.id)!.reason, /no Backpack/);
  assert.equal(feeds.tokenized[x.id].provenance.provider, "pyth");
});

test("feed mapping refuses ticker similarity without the issuer keyword, and a missing feed stays missing", () => {
  const catalog = catalogFromPayload(CATALOG);
  const apple = equityForTicker("AAPL")!;
  const feeds = resolveCompanyFeeds(apple, catalog);
  const x = apple.representations.find((r) => r.provider === "xstocks")!;
  assert.equal(feeds.tokenized[x.id], undefined);
  assert.match(feeds.unmapped.find((u) => u.representationId === x.id)!.reason, /not described as a xStocks product/);
  assert.equal(resolveUnderlyingFeed("ZZZZ", catalog), null);
  // The catalog's `name` is the two symbol segments run together; a mapping
  // must not depend on it, and must not be made without the issuer keyword.
  assert.equal(catalogFromPayload(CATALOG).byId.get(1833)!.name, "NVDAXUSD");
  // Quote currency must be USD.
  const eur = catalogFromPayload([row({ pyth_lazer_id: 5, symbol: "Equity.US.NVDA/USD", asset_type: "equity", quote_currency: "EUR" })]);
  assert.equal(resolveUnderlyingFeed("NVDA", eur), null);
});

test("decimal math: mantissa scaling, ratios and bps are exact", () => {
  assert.equal(scaleMantissa("11223872331053", -8), "112238.72331053");
  assert.equal(scaleMantissa("18500000", -5), "185");
  assert.equal(scaleMantissa("-150", -2), "-1.5");
  assert.equal(scaleMantissa("12", 2), "1200");
  const a = parseDecimal("101.0")!, b = parseDecimal("100")!;
  assert.equal(relativeBps(a, b), 100);
  assert.equal(relativeBps(b, a), -99);
  assert.equal(ratioBps(parseDecimal("0.5")!, b), 50);
  assert.equal(parseDecimal("abc"), null);
});

const NOW = Date.parse("2026-09-16T14:00:00.000Z");
const us = (ms: number) => String(BigInt(ms) * 1000n);

test("latest-price normalization reads freshness from feedUpdateTimestamp and confidence as a data-quality ratio", () => {
  const live = normalizeReference({ priceFeedId: 1314, price: "18500000", exponent: -5, confidence: 9250, publisherCount: 12, marketSession: "regular", feedUpdateTimestamp: us(NOW - 2_000) }, "Equity.US.NVDA/USD", -5, "fixed_rate@200ms", NOW)!;
  assert.equal(live.price, "185");
  assert.equal(live.confidence, "0.0925");
  assert.equal(live.confidenceBps, 5);
  assert.equal(live.freshness, "live");
  assert.equal(live.ageMs, 2000);
  assert.equal(live.provenance.provider, "pyth");
  // A price carried forward for hours in a closed market is not live.
  const carried = normalizeReference({ priceFeedId: 1314, price: "18500000", exponent: -5, marketSession: "closed", feedUpdateTimestamp: us(NOW - 5 * 3_600_000) }, "Equity.US.NVDA/USD", -5, "fixed_rate@200ms", NOW)!;
  assert.equal(carried.freshness, "carried-forward");
  assert.equal(carried.marketSession, "closed");
  // A 24/7 crypto feed that stopped updating is stale, not carried forward.
  const stale = normalizeReference({ priceFeedId: 1833, price: "18500000000", exponent: -8, marketSession: "regular", feedUpdateTimestamp: us(NOW - 6 * 60_000) }, "Crypto.NVDAX/USD", -8, "fixed_rate@200ms", NOW)!;
  assert.equal(stale.freshness, "stale");
  assert.equal(normalizeReference({ priceFeedId: 1, price: null }, "x", -8, "fixed_rate@200ms", NOW), null);
  assert.equal(normalizeReference({ priceFeedId: 1, price: "1" }, "x", -8, "fixed_rate@200ms", NOW)!.freshness, "unknown");
  assert.equal(freshnessOf(PYTH_QUALITY.liveWithinMs + 1, "regular"), "carried-forward");
});

const ref = (o: Partial<PythReference>): PythReference => ({
  feedId: 0, symbol: "x", price: "100", exponent: -8, confidence: "0.01", confidenceBps: 1, emaPrice: null, emaConfidenceBps: null, publisherCount: 10, marketSession: "regular",
  feedUpdateTimestampUs: us(NOW - 1000), feedUpdatedAt: new Date(NOW - 1000).toISOString(), observedAt: new Date(NOW).toISOString(), channel: "fixed_rate@200ms", freshness: "live", ageMs: 1000,
  provenance: { source: "Pyth Pro", provider: "pyth", sourceType: "oracle", observedAt: new Date(NOW).toISOString() }, ...o,
});

test("fair value: token basis needs a Pyth redemption rate; execution deviation needs only the token reference", () => {
  const underlying = ref({ symbol: "Equity.US.NVDA/USD", price: "185" });
  const token = ref({ symbol: "Crypto.NVDAX/USD", price: "186.85" });
  const rr = ref({ symbol: "Crypto.NVDAX/NVDA.RR", price: "1" });
  const a = assessFairValue({ representationId: "xstocks:m", underlying, token, redemptionRate: rr, executable: { price: "187.2", side: "buy", source: "test", quotedAt: new Date(NOW).toISOString() }, now: NOW });
  assert.equal(a.tokenVsUnderlyingBps, 100);
  assert.equal(a.routeVsTokenBps, 19);
  assert.equal(a.status, "OK");
  assert.equal(a.executionReference, "tokenized");
  assert.equal(a.comparability, "redemption-rate");
  // Without a redemption rate the basis is not computed: 1 token = 1 share is never assumed.
  const b = assessFairValue({ representationId: "ondo:m", underlying, token, redemptionRate: null, executable: null, now: NOW });
  assert.equal(b.tokenVsUnderlyingBps, null);
  assert.equal(b.status, "COMPARABILITY_UNVERIFIED");
  assert.ok(b.reasons.some((r) => /no verified token\/share conversion/.test(r)));
  // A route far from the token reference is a deviation; a moderate one is a warning.
  const c = assessFairValue({ representationId: "x", underlying, token, redemptionRate: rr, executable: { price: "192", side: "buy", source: "t", quotedAt: "" }, now: NOW });
  assert.equal(c.status, "EXECUTION_DEVIATION");
  assert.equal(guardStateOf(c), "PYTH_EXECUTION_DEVIATION");
  const d = assessFairValue({ representationId: "x", underlying, token, redemptionRate: rr, executable: { price: "189", side: "buy", source: "t", quotedAt: "" }, now: NOW });
  assert.equal(d.status, "WARNING");
  // A redemption rate other than 1 changes the fair value, not the token price.
  const e = assessFairValue({ representationId: "x", underlying, token: ref({ price: "370" }), redemptionRate: ref({ price: "2" }), executable: null, now: NOW });
  assert.equal(e.tokenVsUnderlyingBps, 0);
});

test("fair value: closed underlying market with a live token keeps the tokenized reference as the boundary; stale everything is STALE; nothing is UNAVAILABLE", () => {
  const closed = ref({ symbol: "Equity.US.NVDA/USD", price: "185", marketSession: "closed", freshness: "carried-forward", ageMs: 4 * 3_600_000 });
  const token = ref({ symbol: "Crypto.NVDAX/USD", price: "186" });
  const a = assessFairValue({ representationId: "x", underlying: closed, token, redemptionRate: null, executable: { price: "186.5", side: "buy", source: "t", quotedAt: "" }, now: NOW });
  assert.equal(a.executionReference, "tokenized");
  assert.equal(a.underlyingMarketSession, "closed");
  assert.ok(a.reasons.some((r) => /underlying market closed/.test(r)));
  assert.equal(a.routeVsTokenBps, 27);
  assert.equal(guardStateOf(a), "PYTH_PASS");
  // Only a stale token and a closed underlying: no execution boundary.
  const b = assessFairValue({ representationId: "x", underlying: closed, token: ref({ freshness: "stale" }), redemptionRate: null, executable: null, now: NOW });
  assert.equal(b.status, "STALE");
  assert.equal(guardStateOf(b), "PYTH_STALE");
  const c = assessFairValue({ representationId: "x", underlying: null, token: null, redemptionRate: null, executable: null, now: NOW });
  assert.equal(c.status, "REFERENCE_UNAVAILABLE");
  assert.equal(guardStateOf(c), "PYTH_REFERENCE_UNAVAILABLE");
  // Underlying only, live and in regular session: the boundary is the underlying.
  const d = assessFairValue({ representationId: "x", underlying: ref({ price: "185" }), token: null, redemptionRate: null, executable: null, now: NOW });
  assert.equal(d.executionReference, "underlying");
  assert.equal(guardStateOf(d), "PYTH_PASS");
});

test("fair value: low publisher count or wide confidence is LOW_DATA_QUALITY", () => {
  const token = ref({ publisherCount: 2 });
  assert.equal(assessFairValue({ representationId: "x", underlying: null, token, redemptionRate: null, executable: null, now: NOW }).status, "LOW_DATA_QUALITY");
  const wide = ref({ confidenceBps: 150 });
  const a = assessFairValue({ representationId: "x", underlying: null, token: wide, redemptionRate: null, executable: null, now: NOW });
  assert.equal(a.status, "LOW_DATA_QUALITY");
  assert.equal(guardStateOf(a), "PYTH_LOW_DATA_QUALITY");
});

test("executable price is derived exactly from a USDC/token pair", () => {
  assert.equal(executablePriceFrom("1000", "5.4"), "185.18518518");
  assert.equal(executablePriceFrom("0", "5"), null);
  assert.equal(executablePriceFrom("10", "0"), null);
});

test("history normalization keeps aligned bars only and never fills gaps; ranges are bounded per resolution", () => {
  const candles = candlesFromPayload({ s: "ok", t: [1, 2, 3], o: [1, 2, "3"], h: [2, 3], l: [0.5, 1, 2], c: [1.5, 2.5, 3.5] });
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[1], { t: 2, o: "2", h: "3", l: "1", c: "2.5", v: null });
  assert.deepEqual(candlesFromPayload({ s: "no_data" }), []);
  const r = clampRange("1", 0, 10 * 86_400);
  assert.equal(r.to - r.from, 3 * 86_400);
});

test("error classification: missing key, invalid key, not entitled (with feed ids), outage", () => {
  assert.equal(classifyStatus(401, "invalid API key").kind, "INVALID_KEY");
  const e = classifyStatus(403, "Not entitled: feed 1314 (invalid API key)");
  assert.equal(e.kind, "NOT_ENTITLED");
  assert.deepEqual(e.feedIds, [1314]);
  assert.deepEqual(notEntitledFeedIds("feed 1 and feed 22"), [1, 22]);
  assert.equal(classifyStatus(404, "").kind, "NOT_FOUND");
  assert.equal(classifyStatus(429, "").kind, "RATE_LIMITED");
  assert.equal(classifyStatus(503, "").kind, "UNAVAILABLE");
  assert.equal(availabilityFromError(classifyStatus(401, "")), "INVALID");
  assert.equal(availabilityFromError(classifyStatus(403, "")), "NOT_ENTITLED");
  assert.equal(availabilityFromError(new Error("boom")), "UNAVAILABLE");
});

test("latest price with no key reports NOT_CONFIGURED without calling Pyth", async () => {
  const { latestReferences } = await import("../src/lib/pyth/price");
  let called = 0;
  const result = await latestReferences([{ feedId: 1, symbol: "x", exponent: -8 }], { apiKey: null, fetch: (async () => { called++; return new Response("{}"); }) as typeof fetch });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(called, 0);
});

test("latest price: a partial 403 keeps the entitled feeds and names the refused one", async () => {
  const { latestReferences } = await import("../src/lib/pyth/price");
  const calls: number[][] = [];
  const fake = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { priceFeedIds: number[] };
    calls.push(body.priceFeedIds);
    if (body.priceFeedIds.includes(2)) return new Response("Not entitled: feed 2 (invalid API key)", { status: 403 });
    return new Response(JSON.stringify({ parsed: { timestampUs: "1", priceFeeds: body.priceFeedIds.map((id) => ({ priceFeedId: id, price: "100000000", exponent: -8, feedUpdateTimestamp: us(NOW) })) } }), { status: 200 });
  }) as typeof fetch;
  const result = await latestReferences([{ feedId: 1, symbol: "a", exponent: -8 }, { feedId: 2, symbol: "b", exponent: -8 }], { apiKey: "k", fetch: fake, now: () => NOW });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.feeds[1]?.price, "1");
  assert.deepEqual(result.notEntitled, [2]);
  assert.equal(result.feeds[2], undefined);
});

test("flags: read-only surfaces default on, execution flags default off, guard mode defaults to observe", () => {
  assert.equal(henarFlag("pythPro", {}), true);
  assert.equal(henarFlag("preIpoMarkets", {}), true);
  assert.equal(henarFlag("pythPro", { HENAR_PYTH_PRO: "0" }), false);
  assert.equal(henarFlag("privateMarketsRouting", {}), false);
  assert.equal(henarFlag("privateMarketsRouting", { HENAR_PRIVATE_MARKETS_ROUTING: "1" }), true);
  assert.equal(pythGuardMode({}), "observe");
  assert.equal(pythGuardMode({ HENAR_PYTH_GUARD_MODE: "enforce" }), "enforce");
  assert.equal(pythGuardMode({ HENAR_PYTH_GUARD_MODE: "nonsense" }), "observe");
});

/**
 * The entitlement probe can only afford to test a sample of the mapped
 * universe. A narrow key — the free demo reads two of 897 mapped underlyings —
 * is invisible to a sample taken off the front of the list, and the whole
 * entitlement then reads as absent. The sample must therefore reach the
 * companies Henar demonstrates with, and spread over the rest.
 */
test("the entitlement sample reaches demo tickers and spreads over the remainder", () => {
  const all = Array.from({ length: 900 }, (_, i) => ({ ticker: `T${i}` }));
  // A demo ticker far past any leading slice.
  all[880] = { ticker: "TSLA" };
  all[640] = { ticker: "QQQ" };

  const sample = spreadSample(all, 60);
  assert.equal(sample.length, 60);
  assert.ok(sample.some((f) => f.ticker === "TSLA"));
  assert.ok(sample.some((f) => f.ticker === "QQQ"));
  // Not a leading slice: the tail of the universe is represented too.
  const indexes = sample.map((f) => all.indexOf(f as (typeof all)[number]));
  assert.ok(Math.max(...indexes) > 800);
  assert.equal(new Set(sample).size, sample.length);
});

test("a sample smaller than the list keeps every entry", () => {
  const all = [{ ticker: "A" }, { ticker: "TSLA" }, { ticker: "B" }];
  assert.equal(spreadSample(all, 60).length, 3);
});
