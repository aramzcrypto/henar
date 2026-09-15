import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateExecutionQuotes,
  aggregateIndicativeQuotes,
} from "../src/lib/execution/aggregate";
import {
  aggregatePoolLiquidity,
  orcaLiquidity,
} from "../src/lib/execution/liquidity";
import {
  OPENOCEAN_PROVIDER_FEE_BPS,
  quoteOpenOcean,
} from "../src/lib/execution/adapters/openocean";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

test("OpenOcean normalizes a verified quote and deducts its provider fee", async () => {
  const previousFetch = global.fetch;
  const previousEndpoint = process.env.OPENOCEAN_API_URL;
  process.env.OPENOCEAN_API_URL = "https://quicknode.example/addon/807";
  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/addon/807/v4/solana/quote");
    assert.equal(url.searchParams.get("inTokenAddress"), USDC);
    assert.equal(url.searchParams.get("outTokenAddress"), SOL);
    assert.equal(url.searchParams.get("amountDecimals"), "1000000");
    return Response.json({
      code: 200,
      data: {
        code: 0,
        inToken: { address: USDC, decimals: 6 },
        outToken: { address: SOL, decimals: 9 },
        inAmount: "1000000",
        outAmount: "10000000",
        minOutAmount: "9950000",
        dexId: 10,
        dexes: [
          {
            dexCode: "Titan",
            dexIndex: 10,
            swapAmount: "10000000",
            minOutAmount: "9950000",
          },
        ],
        price_impact: "0.04%",
      },
    });
  }) as typeof fetch;
  try {
    const quote = await quoteOpenOcean({
      inputMint: USDC,
      outputMint: SOL,
      amount: 1_000_000n,
      slippageBps: 50,
    });
    assert.equal(quote.grossOutputAmount, "10000000");
    // OpenOcean's own provider fee, not Henar's: it is unaffected by the
    // Henar fee constant and must not be derived from it.
    const providerFee = (10_000_000n * BigInt(OPENOCEAN_PROVIDER_FEE_BPS)) / 10_000n;
    assert.equal(quote.outputAmount, (10_000_000n - providerFee).toString());
    assert.equal(quote.minimumOutputAmount, "9935075");
    assert.equal(quote.providerFeeBps, OPENOCEAN_PROVIDER_FEE_BPS);
    assert.equal(quote.providerFeeAmount, "15000");
    assert.equal(quote.route[0].venue, "Titan");
    assert.equal(quote.transactionAvailable, false);
  } finally {
    global.fetch = previousFetch;
    if (previousEndpoint) process.env.OPENOCEAN_API_URL = previousEndpoint;
    else delete process.env.OPENOCEAN_API_URL;
  }
});

test("execution aggregation ranks exact integer output and preserves quote provenance", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.JUPITER_API_KEY;
  const previousTitanUrl = process.env.TITAN_WS_URL;
  const previousTitanKey = process.env.TITAN_API_KEY;
  process.env.JUPITER_API_KEY = "test";
  delete process.env.TITAN_WS_URL;
  delete process.env.TITAN_API_KEY;
  let jupiterRequests = 0;
  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "transaction-v1.raydium.io")
      return Response.json({
        id: "raydium-quote",
        success: true,
        data: {
          inputMint: USDC,
          inputAmount: "1000000",
          outputMint: SOL,
          outputAmount: "110",
          otherAmountThreshold: "109",
          slippageBps: 50,
          priceImpactPct: 0.02,
          routePlan: [
            { poolId: "11111111111111111111111111111111", feeRate: 25 },
          ],
        },
      });
    if (url.hostname === "api.jup.ag") {
      jupiterRequests += 1;
      const restricted = url.pathname.includes("/v1/");
      return Response.json({
        inputMint: USDC,
        outputMint: SOL,
        inAmount: "1000000",
        outAmount: restricted ? "90" : "100",
        otherAmountThreshold: restricted ? "89" : "99",
        slippageBps: 50,
        priceImpactPct: "0.03",
        routePlan: [
          {
            percent: 100,
            swapInfo: {
              ammKey: "11111111111111111111111111111111",
              label: restricted ? "Restricted venue" : "Meta route",
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const quote = await aggregateExecutionQuotes({
      inputMint: USDC,
      outputMint: SOL,
      amount: 1_000_000n,
      slippageBps: 50,
    });
    assert.equal(quote.selected?.source, "raydium");
    assert.equal(quote.selected?.quoteProvider, "raydium");
    assert.equal(quote.selected?.outputAmount, "110");
    assert.equal(
      jupiterRequests,
      1,
      "independent quote aggregation must reserve Jupiter capacity",
    );
    assert.deepEqual(
      quote.sources.find((source) => source.source === "titan"),
      {
        source: "titan",
        status: "unavailable",
        reason: "Titan is not configured.",
      },
    );
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
    if (previousTitanUrl) process.env.TITAN_WS_URL = previousTitanUrl;
    else delete process.env.TITAN_WS_URL;
    if (previousTitanKey) process.env.TITAN_API_KEY = previousTitanKey;
    else delete process.env.TITAN_API_KEY;
  }
});

test("concurrent identical indicative quotes share provider work", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.JUPITER_API_KEY;
  const previousOpenOcean = process.env.OPENOCEAN_API_URL;
  const previousTitanUrl = process.env.TITAN_WS_URL;
  const previousTitanKey = process.env.TITAN_API_KEY;
  process.env.JUPITER_API_KEY = "test";
  delete process.env.OPENOCEAN_API_URL;
  delete process.env.TITAN_WS_URL;
  delete process.env.TITAN_API_KEY;
  let jupiterRequests = 0;
  let raydiumRequests = 0;
  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "api.jup.ag") {
      jupiterRequests += 1;
      return Response.json({
        inputMint: USDC,
        outputMint: SOL,
        inAmount: "2000000",
        outAmount: "200",
        otherAmountThreshold: "199",
        slippageBps: 50,
        routePlan: [],
      });
    }
    if (url.hostname === "transaction-v1.raydium.io") {
      raydiumRequests += 1;
      return Response.json({
        id: "shared-raydium-quote",
        success: true,
        data: {
          inputMint: USDC,
          inputAmount: "2000000",
          outputMint: SOL,
          outputAmount: "201",
          otherAmountThreshold: "200",
          slippageBps: 50,
          routePlan: [],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const request = {
      inputMint: USDC,
      outputMint: SOL,
      amount: 2_000_000n,
      slippageBps: 50,
    };
    await Promise.all([
      aggregateIndicativeQuotes(request),
      aggregateIndicativeQuotes(request),
    ]);
    assert.equal(jupiterRequests, 1);
    assert.equal(raydiumRequests, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
    if (previousOpenOcean) process.env.OPENOCEAN_API_URL = previousOpenOcean;
    else delete process.env.OPENOCEAN_API_URL;
    if (previousTitanUrl) process.env.TITAN_WS_URL = previousTitanUrl;
    else delete process.env.TITAN_WS_URL;
    if (previousTitanKey) process.env.TITAN_API_KEY = previousTitanKey;
    else delete process.env.TITAN_API_KEY;
  }
});

test("pool aggregation keeps provider pools separate and reports partial failure", async () => {
  const previousFetch = global.fetch;
  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "api-v3.raydium.io")
      return Response.json({
        success: true,
        data: {
          data: [
            {
              id: "ray-pool",
              mintA: { address: USDC },
              mintB: { address: SOL },
              price: 100,
              feeRate: 0.0025,
              tvl: 1_000,
              day: { volume: 500 },
            },
          ],
        },
      });
    if (url.hostname === "dlmm.datapi.meteora.ag")
      return Response.json({ data: [] });
    if (url.hostname === "api.orca.so")
      return new Response("blocked", { status: 503 });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const value = await aggregatePoolLiquidity(USDC, SOL);
    assert.equal(value.pools.length, 1);
    assert.equal(value.pools[0].source, "raydium");
    assert.equal(value.pools[0].liquidityUsd, 1_000);
    assert.equal(
      value.sources.find((source) => source.source === "orca")?.status,
      "unavailable",
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("Orca pool data uses an exact mint-pair query and normalizes string metrics", async () => {
  const previousFetch = global.fetch;
  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/solana/pools");
    assert.equal(url.searchParams.get("tokensBothOf"), `${USDC},${SOL}`);
    assert.equal(url.searchParams.get("stats"), "24h");
    return Response.json({
      data: [
        {
          address: "orca-pool",
          tokenMintA: USDC,
          tokenMintB: SOL,
          tvlUsdc: "1250000.50",
          price: "100.25",
          feeRate: 2000,
          stats: { "24h": { volume: "345000.75" } },
        },
      ],
    });
  }) as typeof fetch;
  try {
    const pools = await orcaLiquidity(USDC, SOL);
    assert.equal(pools.length, 1);
    assert.equal(pools[0].liquidityUsd, 1_250_000.5);
    assert.equal(pools[0].volume24hUsd, 345_000.75);
    assert.equal(pools[0].feePct, 0.2);
    assert.equal(pools[0].price, 100.25);
  } finally {
    global.fetch = previousFetch;
  }
});

test("Raydium remains available when Jupiter and Titan are not configured", async () => {
  const previousFetch = global.fetch;
  const previousJupiter = process.env.JUPITER_API_KEY;
  const previousTitanUrl = process.env.TITAN_WS_URL;
  const previousTitanKey = process.env.TITAN_API_KEY;
  delete process.env.JUPITER_API_KEY;
  delete process.env.TITAN_WS_URL;
  delete process.env.TITAN_API_KEY;
  global.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "transaction-v1.raydium.io");
    return Response.json({
      id: "raydium-only",
      success: true,
      data: {
        inputMint: USDC,
        inputAmount: "1000000",
        outputMint: SOL,
        outputAmount: "100",
        otherAmountThreshold: "99",
        slippageBps: 50,
        routePlan: [{ poolId: "11111111111111111111111111111111" }],
      },
    });
  }) as typeof fetch;
  try {
    const quote = await aggregateExecutionQuotes({
      inputMint: USDC,
      outputMint: SOL,
      amount: 1_000_000n,
      slippageBps: 50,
    });
    assert.equal(quote.selected?.source, "raydium");
    assert.equal(quote.candidates.length, 1);
    assert.equal(
      quote.sources.find((source) => source.source === "jupiter")?.status,
      "unavailable",
    );
  } finally {
    global.fetch = previousFetch;
    if (previousJupiter) process.env.JUPITER_API_KEY = previousJupiter;
    else delete process.env.JUPITER_API_KEY;
    if (previousTitanUrl) process.env.TITAN_WS_URL = previousTitanUrl;
    else delete process.env.TITAN_WS_URL;
    if (previousTitanKey) process.env.TITAN_API_KEY = previousTitanKey;
    else delete process.env.TITAN_API_KEY;
  }
});
