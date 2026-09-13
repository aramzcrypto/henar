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
import { consumePublicQuoteBudget } from "../src/lib/equities/rate-limit";

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
  const request = new Request("https://henar.test/api/quote", {
    headers: { "x-forwarded-for": "203.0.113.44" },
  });
  for (let index = 0; index < 20; index++)
    assert.equal(consumePublicQuoteBudget(request, 10_000), true);
  assert.equal(consumePublicQuoteBudget(request, 10_000), false);
  assert.equal(consumePublicQuoteBudget(request, 70_001), true);
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
    if (url.includes("/swap/v1/quote")) {
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
    assert.equal(quote.selectedRepresentation.protocolFeeAmount, "15");
    assert.equal(quote.alternatives.length, 3);
    assert.equal(quote.executable, false);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
  }
});
