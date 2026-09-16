/**
 * Jupiter answers the same question at two endpoints, and they disagree.
 *
 * `/swap/v2/order` reaches JupiterZ, Jupiter's RFQ network, which is worth a
 * great deal on thin names: measured 17 September 2026 it beat the plain
 * quote by 262 bps on AMC and 102 bps on IBM. `/swap/v1/quote` does not reach
 * it, but where both find the same route the v1 answer came back about 10 bps
 * better, in 7 of 14 pairs and almost exactly 10 bps each time.
 *
 * Henar asked only the first. So on every liquid pair it resold Jupiter at a
 * 10 bps discount to Jupiter's own price and charged 10 bps on top of that.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { quoteJupiter } from "../src/lib/execution/adapters/jupiter";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const request = { inputMint: USDC, outputMint: SOL, amount: 1_000_000n, slippageBps: 50 };

function stub(byEndpoint: Record<"order" | "quote", { out: string } | "fail">) {
  const seen: string[] = [];
  const fetchStub = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const which = url.pathname.includes("/v2/order") ? "order" : "quote";
    seen.push(which);
    const row = byEndpoint[which];
    if (row === "fail") return new Response("no route", { status: 404 });
    return Response.json({
      inputMint: USDC,
      outputMint: SOL,
      inAmount: "1000000",
      outAmount: row.out,
      otherAmountThreshold: String(BigInt(row.out) - 1n),
      slippageBps: 50,
      priceImpactPct: "0.01",
      routePlan: [{ percent: 100, swapInfo: { ammKey: "pool", label: which === "order" ? "JupiterZ" : "Whirlpool" } }],
    });
  }) as typeof fetch;
  return { fetchStub, seen };
}

async function withStub<T>(s: ReturnType<typeof stub>, run: () => Promise<T>) {
  const previousFetch = global.fetch;
  const previousKey = process.env.JUPITER_API_KEY;
  const previousRace = process.env.HENAR_JUPITER_RACE;
  process.env.JUPITER_API_KEY = "test";
  delete process.env.HENAR_JUPITER_RACE;
  global.fetch = s.fetchStub;
  try {
    return await run();
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
    if (previousRace !== undefined) process.env.HENAR_JUPITER_RACE = previousRace;
  }
}

test("both Jupiter endpoints are asked, and the better answer is kept", async () => {
  const s = stub({ order: { out: "100" }, quote: { out: "110" } });
  const q = await withStub(s, () => quoteJupiter(request));
  assert.deepEqual([...s.seen].sort(), ["order", "quote"]);
  assert.equal(q.outputAmount, "110", "the plain quote won and must be the one returned");
});

test("the RFQ endpoint wins when it is better, which is the thin-name case", async () => {
  const s = stub({ order: { out: "150" }, quote: { out: "110" } });
  const q = await withStub(s, () => quoteJupiter(request));
  assert.equal(q.outputAmount, "150");
  assert.equal(q.route[0].venue, "JupiterZ");
});

test("one endpoint failing does not lose the other's quote", async () => {
  for (const failing of ["order", "quote"] as const) {
    const s = stub({ order: failing === "order" ? "fail" : { out: "120" }, quote: failing === "quote" ? "fail" : { out: "120" } });
    const q = await withStub(s, () => quoteJupiter(request));
    assert.equal(q.outputAmount, "120", `${failing} failed and the other answer should stand`);
  }
});

test("both failing still raises, rather than inventing a route", async () => {
  const s = stub({ order: "fail", quote: "fail" });
  await assert.rejects(withStub(s, () => quoteJupiter(request)));
});

test("a venue-restricted probe asks one endpoint, to reserve Jupiter capacity", async () => {
  const s = stub({ order: { out: "100" }, quote: { out: "110" } });
  await withStub(s, () => quoteJupiter(request, { source: "orca", dexes: ["Whirlpool"] }));
  assert.deepEqual(s.seen, ["quote"], "restricted probes are a v1 feature and stay a single call");
});

test("HENAR_JUPITER_RACE=0 returns to one call", async () => {
  const s = stub({ order: { out: "100" }, quote: { out: "110" } });
  const previousFetch = global.fetch;
  const previousKey = process.env.JUPITER_API_KEY;
  process.env.JUPITER_API_KEY = "test";
  process.env.HENAR_JUPITER_RACE = "0";
  global.fetch = s.fetchStub;
  try {
    const q = await quoteJupiter(request);
    assert.deepEqual(s.seen, ["order"]);
    assert.equal(q.outputAmount, "100");
  } finally {
    global.fetch = previousFetch;
    delete process.env.HENAR_JUPITER_RACE;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
  }
});

test("a fee Jupiter reports is recorded, not assumed to be zero", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.JUPITER_API_KEY;
  process.env.JUPITER_API_KEY = "test";
  global.fetch = (async () =>
    Response.json({
      inputMint: USDC,
      outputMint: SOL,
      inAmount: "1000000",
      outAmount: "100",
      otherAmountThreshold: "99",
      slippageBps: 50,
      platformFee: { amount: "250", feeBps: 8 },
      routePlan: [{ percent: 100, swapInfo: { ammKey: "pool", label: "Whirlpool" } }],
    })) as typeof fetch;
  try {
    const q = await quoteJupiter(request);
    assert.equal(q.providerFeeBps, 8);
    assert.equal(q.providerFeeAmount, "250");
  } finally {
    global.fetch = previousFetch;
    if (previousKey) process.env.JUPITER_API_KEY = previousKey;
    else delete process.env.JUPITER_API_KEY;
  }
});
