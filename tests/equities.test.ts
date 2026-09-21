import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { adaptXStocks } from "../src/lib/equities/providers/xstocks";
import {
  aggregateQuote,
  marketsOverview,
  normalizedPriceImpact,
} from "../src/lib/equities/jupiter";
import { corporateActionsFor } from "../src/lib/equities/corporate-actions";
import { equityForTicker, equityRegistry } from "../src/lib/equities/registry";
import { researchForEquity } from "../src/lib/equities/research";
import {
  companyCandidatesForMints,
  groupRepresentationHoldings,
} from "../src/lib/equities/compatibility";
import type { CatalogEntry } from "../src/lib/equities/providers/common";
import { clientKey, consumePublicQuoteBudget, consumeRelayBudget } from "../src/lib/equities/rate-limit";
import { tradeFee } from "@/lib/trade-fee";
import { tokenizedShare } from "@/components/market-detail";

test("canonical registry groups verified provider mints under one company", () => {
  assert.equal(equityRegistry.length, 1_339);
  const nvidia = equityForTicker("nvda");
  assert.ok(nvidia);
  assert.equal(nvidia.name, "NVIDIA");
  assert.deepEqual(
    nvidia.representations.map((item) => item.provider),
    ["backpack", "xstocks", "ondo"],
  );
  assert.equal(
    nvidia.representations.find((item) => item.provider === "backpack")?.mint,
    "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv",
  );
  for (const equity of equityRegistry) {
    assert.equal(equity.id, `equity:${equity.ticker}`);
    assert.ok(equity.representations.length > 0);
    for (const representation of equity.representations) {
      assert.equal(representation.equityId, equity.id);
      assert.equal(
        new PublicKey(representation.mint).toBase58(),
        representation.mint,
      );
      assert.equal(representation.providerStatus, "verified");
      assert.match(representation.sourceUrl, /^https:\/\//);
    }
  }
});

test("provider adapters reject data attributed to the wrong public source", () => {
  const entry: CatalogEntry = {
    provider: "xStocks",
    ticker: "NVDAx",
    name: "NVIDIA",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    category: "AI",
    instrument: "Stock",
    source: "https://example.com/unverified",
    logoSource: "https://example.com/logo.png",
    logo: "/logos/248bc43df1cc155ab0.png",
    underlying: "NVDA",
  };
  assert.throws(() => adaptXStocks(entry), /Invalid xStocks catalog source/);
});

test("verified equity representations disclose issuer redemption models", () => {
  const nvidia = equityForTicker("NVDA")!;
  assert.deepEqual(
    Object.fromEntries(
      nvidia.representations.map((item) => [
        item.provider,
        item.redemptionModel,
      ]),
    ),
    {
      backpack: "1:1 security entitlement · Account required",
      xstocks: "Cash value or underlying · Eligibility required",
      ondo: "Stablecoin cash value · Eligibility required",
    },
  );
});

test("research and corporate actions stay explicitly unavailable without verified records", () => {
  const research = researchForEquity();
  for (const section of Object.values(research)) {
    assert.equal(section.status, "unavailable");
    assert.equal(section.data, null);
  }
  assert.deepEqual(corporateActionsFor("equity:NVDA"), []);
});

test("price impact accepts documented percent formats and rejects invalid upstream values", () => {
  assert.equal(normalizedPriceImpact("0.04"), 0.04);
  assert.equal(normalizedPriceImpact("0.04%"), 0.04);
  assert.equal(normalizedPriceImpact("-14.99%"), null);
  assert.equal(normalizedPriceImpact("unavailable"), null);
});

test("portfolio and packs compatibility group by company without merging token balances", () => {
  const nvidia = equityForTicker("NVDA")!;
  const holdings = nvidia.representations.map((representation, index) => ({
    mint: representation.mint,
    rawAmount: index === 0 ? "100000000" : "2000000000",
    decimals: index === 0 ? 8 : 9,
  }));
  const grouped = groupRepresentationHoldings(holdings);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].ticker, "NVDA");
  assert.deepEqual(grouped[0].representations, holdings);
  assert.deepEqual(
    companyCandidatesForMints(nvidia.representations.map((item) => item.mint)),
    [{ equityId: "equity:NVDA", ticker: "NVDA", name: "NVIDIA" }],
  );
});

test("public quote work is bounded per client and resets at window expiry", () => {
  /* The bound is configurable, so the test sets it rather than encoding a
     number that moves: what matters is that a client is bounded at all, that
     the bound is the one configured, and that the window expires. */
  const previous = process.env.HENAR_PUBLIC_QUOTE_BUDGET;
  process.env.HENAR_PUBLIC_QUOTE_BUDGET = "20";
  try {
    const request = new Request("https://henar.test/api/quote", {
      headers: { "x-forwarded-for": "203.0.113.44" },
    });
    for (let index = 0; index < 20; index++)
      assert.equal(consumePublicQuoteBudget(request, 10_000), true);
    assert.equal(consumePublicQuoteBudget(request, 10_000), false);
    assert.equal(consumePublicQuoteBudget(request, 70_001), true);
  } finally {
    if (previous === undefined) delete process.env.HENAR_PUBLIC_QUOTE_BUDGET;
    else process.env.HENAR_PUBLIC_QUOTE_BUDGET = previous;
  }
});

test("the default quote budget leaves room for a trade ticket and a comparison", () => {
  /* Guards the reason the number was raised: a ticket refreshing four times a
     minute across three pairs, plus the markets page, must not exhaust it. */
  const previous = process.env.HENAR_PUBLIC_QUOTE_BUDGET;
  delete process.env.HENAR_PUBLIC_QUOTE_BUDGET;
  try {
    const request = new Request("https://henar.test/api/quote", {
      headers: { "x-forwarded-for": "203.0.113.77" },
    });
    for (let index = 0; index < 40; index++)
      assert.equal(consumePublicQuoteBudget(request, 10_000), true, `quote ${index + 1} was refused`);
  } finally {
    if (previous !== undefined) process.env.HENAR_PUBLIC_QUOTE_BUDGET = previous;
  }
});

test("market overview intersects Jupiter activity with exact verified mints", async () => {
  const nvidia = equityForTicker("NVDA")!;
  const previousKey = process.env.JUPITER_API_KEY;
  const previousFetch = global.fetch;
  process.env.JUPITER_API_KEY = "test";
  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/toptraded/"))
      return Response.json([
        { id: "So11111111111111111111111111111111111111112" },
        { id: nvidia.representations[0].mint },
      ]);
    if (url.includes("/price/v3"))
      return Response.json(
        Object.fromEntries(
          nvidia.representations.map((item) => [
            item.mint,
            { usdPrice: 200, liquidity: 1_000, priceChange24h: 2 },
          ]),
        ),
      );
    if (url.includes("/tokens/v2/search"))
      return Response.json(
        nvidia.representations.map((item) => ({
          id: item.mint,
          stats24h: { buyVolume: 20, sellVolume: 30 },
        })),
      );
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const overview = await marketsOverview();
    assert.equal(overview.sourceTokenCount, 2);
    assert.equal(overview.matchedCompanyCount, 1);
    assert.deepEqual(
      overview.items.map((item) => item.ticker),
      ["NVDA"],
    );
    assert.deepEqual(
      overview.items[0].representationSymbols,
      nvidia.representations.map(({ provider, tokenSymbol }) => ({
        provider,
        tokenSymbol,
      })),
    );
    assert.equal(overview.totalVolume24hUsd, 150);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
  }
});

test("quote aggregation compares representations and includes the fixed protocol fee", async () => {
  const equity = equityForTicker("NVDA")!;
  const previousKey = process.env.JUPITER_API_KEY;
  const previousFetch = global.fetch;
  process.env.JUPITER_API_KEY = "test";
  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/price/v3"))
      return Response.json(
        Object.fromEntries(
          equity.representations.map((item, index) => [
            item.mint,
            {
              usdPrice: 200,
              liquidity: index === 0 ? 1_000_000 : 500_000,
              decimals: index === 0 ? 8 : 9,
            },
          ]),
        ),
      );
    if (url.includes("/tokens/v2/search"))
      return Response.json(
        equity.representations.map((item, index) => ({
          id: item.mint,
          decimals: index === 0 ? 8 : 9,
          tokenProgram: "TokenzQdYhwoNqS7KXYN9xZcZ3aWfH1kP6bQxQvZ7n",
          stats24h: { buyVolume: 10, sellVolume: 20 },
        })),
      );
    if (url.includes("/swap/v2/order")) {
      const request = new URL(url);
      const outputMint = request.searchParams.get("outputMint")!;
      const better = outputMint === equity.representations[0].mint;
      return Response.json({
        inputMint: request.searchParams.get("inputMint"),
        outputMint,
        inAmount: request.searchParams.get("amount"),
        outAmount: better ? "5000000000" : "49500000000",
        otherAmountThreshold: better ? "4975000000" : "49252500000",
        priceImpactPct: better ? "0.02" : "0.03",
        routePlan: [{ percent: 100, swapInfo: { label: "Test venue" } }],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const quote = await aggregateQuote(equity, "buy", "10000");
    assert.equal(
      quote.selectedRepresentation.provider,
      equity.representations[0].provider,
    );
    assert.equal(quote.selectedRepresentation.protocolFeeAmount, tradeFee(10_000n).toString());
    assert.equal(quote.alternatives.length, 3);
    assert.equal(quote.executable, false);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
  }
});

test("a rate-limit bucket cannot be chosen by the caller", () => {
  /* The leftmost x-forwarded-for entry is an assertion by the client; the
     last is what the platform observed. Keying on the first meant one header
     bought a fresh budget per request, so the ceiling never engaged. */
  const req = (headers: Record<string, string>) =>
    new Request("https://henar.test/api/quote", { headers });

  // A spoofed leading hop is ignored in favour of the observed one.
  assert.equal(clientKey(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientKey(req({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9");

  // The platform header wins outright, whatever the client claims.
  assert.equal(
    clientKey(req({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "1.2.3.4" })),
    "203.0.113.9",
  );
  assert.equal(clientKey(req({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(clientKey(req({})), "local");

  // Two requests differing only in the spoofable prefix share one bucket.
  const rotating = (n: number) => req({ "x-forwarded-for": `10.0.0.${n}, 203.0.113.9` });
  const now = Date.now();
  let allowed = 0;
  for (let i = 0; i < 80; i += 1) if (consumePublicQuoteBudget(rotating(i), now)) allowed += 1;
  assert.ok(allowed <= 60, `rotating the claimed hop must not lift the ceiling (allowed ${allowed})`);
});

test("wallet traffic is bounded on its own counter, not the quote budget", () => {
  /* One trade spends a blockhash read, a simulation, a submission and several
     status polls, and a page spends balance reads before any of that. Holding
     the relay to the quote ceiling would refuse ordinary use behind a shared
     address. It is bounded, just not at the same number, and spending one
     never spends the other. */
  const req = () => new Request("https://henar.test/api/rpc", { headers: { "x-vercel-forwarded-for": "203.0.113.55" } });
  const now = Date.now();
  let relay = 0;
  for (let i = 0; i < 300; i += 1) if (consumeRelayBudget(req(), now)) relay += 1;
  assert.ok(relay > 60, `the relay must clear the quote ceiling (allowed ${relay})`);
  assert.ok(relay <= 240, `but it is still bounded (allowed ${relay})`);

  // Exhausting the relay leaves the quote budget for that client untouched.
  assert.equal(consumeRelayBudget(req(), now), false, "relay is exhausted");
  assert.equal(consumePublicQuoteBudget(req(), now), true, "quotes are unaffected");
});

test("the company's market cap and its tokenized value are different quantities", () => {
  /* The company page showed the most liquid mint's token cap under the label
     "Market cap". For NVIDIA that is about $72M against a real $5.4T — four
     orders of magnitude out, under a label every reader takes at face value.
     They are never summed either: the tokens are claims on shares already
     counted inside the company's own cap. */
  const NVDA_COMPANY = 5_367_153_690_000;
  const NVDA_TOKENIZED = 75_652_385;

  assert.equal(tokenizedShare(NVDA_COMPANY, NVDA_TOKENIZED), "0.0014%");
  // Two decimals would have printed "0.00%", which reads as none rather than early.
  assert.notEqual(tokenizedShare(NVDA_COMPANY, NVDA_TOKENIZED), "0.00%");
  assert.equal(tokenizedShare(687_502_081_724, 74_536_530), "0.011%");
  assert.equal(tokenizedShare(1_000, 250), "25.0%");

  // Missing either side is unavailable, never zero and never a guess.
  assert.equal(tokenizedShare(null, NVDA_TOKENIZED), "—");
  assert.equal(tokenizedShare(NVDA_COMPANY, null), "—");
  assert.equal(tokenizedShare(0, NVDA_TOKENIZED), "—");
  assert.equal(tokenizedShare(Number.NaN, 1), "—");
  assert.equal(tokenizedShare(NVDA_COMPANY, 0), "—");
});
