/**
 * Token Terminal layer, offline.
 *
 * The API is on Token Terminal's paid plan, so the deployment Henar ships
 * with cannot call it. That makes two things worth testing precisely: that
 * the surface says exactly why it is dark rather than showing zeros, and that
 * the client is correct against the published contract, so configuring a key
 * is the only step needed to switch it on.
 *
 * Fixtures mirror the documented response shapes in the published OpenAPI
 * spec, read 20 September 2026.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  fetchAssetBreakdown,
  fetchAssets,
  TokenTerminalError,
} from "../src/lib/tokenterminal/client";
import { assetMetrics, indexByAddress, matchMints } from "../src/lib/tokenterminal/assets";
import { availabilityFromError, issuerExternalCoverage, tokenTerminalCoverage } from "../src/lib/tokenterminal/coverage";
import { tokenTerminalApiKey, TOKEN_TERMINAL, TOKEN_TERMINAL_METRICS } from "../src/lib/tokenterminal/config";
import { issuerRepresentations } from "../src/lib/issuers/profiles";

const KEY = "test-key";

function jsonStub(handler: (url: URL, init: RequestInit | undefined) => unknown) {
  const seen: { url: string; authorization: string | null; body: string | null }[] = [];
  const stub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    seen.push({
      url: url.toString(),
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const value = handler(url, init);
    if (value instanceof Response) return value;
    return Response.json(value);
  }) as typeof fetch;
  return { stub, seen };
}

test("failures are classified, and an invalid key is not mistaken for an entitlement refusal", () => {
  // What the live API actually answers with no key, probed 20 September 2026.
  assert.equal(classifyStatus(403, '{"message":"invalid token"}').kind, "INVALID_KEY");
  assert.equal(classifyStatus(403, "feed not included in your plan").kind, "NOT_ENTITLED");
  assert.equal(classifyStatus(401, "").kind, "INVALID_KEY");
  assert.equal(classifyStatus(404, "").kind, "NOT_FOUND");
  assert.equal(classifyStatus(429, "").kind, "RATE_LIMITED");
  assert.equal(classifyStatus(400, "").kind, "BAD_REQUEST");
  assert.equal(classifyStatus(503, "").kind, "UNAVAILABLE");
  assert.equal(availabilityFromError(new TokenTerminalError("MISSING_KEY", "no key")), "NOT_CONFIGURED");
  assert.equal(availabilityFromError(new TokenTerminalError("NOT_ENTITLED", "no")), "NOT_ENTITLED");
  assert.equal(availabilityFromError(new Error("something else")), "UNAVAILABLE");
});

test("the key is read from the environment and never defaulted", () => {
  assert.equal(tokenTerminalApiKey({}), null);
  assert.equal(tokenTerminalApiKey({ TOKENTERMINAL_API_KEY: "  " }), null);
  assert.equal(tokenTerminalApiKey({ TOKENTERMINAL_API_KEY: " abc " }), "abc");
});

test("assets are matched on the published token address, never on a symbol", () => {
  const nvidia = issuerRepresentations("xstocks").find((r) => r.tokenSymbol === "NVDAx")!;
  const other = issuerRepresentations("ondo")[0];
  const catalog = [
    {
      asset_id: "nvidia-xstock",
      symbol: "NVDAx",
      name: "NVIDIA xStock",
      asset_type: "tokenized_stock",
      reference_asset_id: "nvda",
      addresses: [
        { chain_id: "solana", token_address: nvidia.mint },
        { chain_id: "ethereum", token_address: "0xabc" },
      ],
      products: [{ data_id: "backed", product_id: "xstocks", relation_to_the_project: "issuer" }],
    },
    // A look-alike: same symbol shape, an address Henar never verified.
    {
      asset_id: "impostor",
      symbol: "NVDAx",
      addresses: [{ chain_id: "solana", token_address: "NotAVerifiedMint111111111111111111111111" }],
    },
    // A duplicate address must not displace the first match.
    { asset_id: "duplicate", symbol: "NVDAx", addresses: [{ chain_id: "solana", token_address: nvidia.mint }] },
  ];
  const index = indexByAddress(catalog);
  const matches = matchMints([nvidia.mint, other.mint], index);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].assetId, "nvidia-xstock");
  assert.equal(matches[0].referenceAssetId, "nvda");
  assert.deepEqual(matches[0].chains, ["solana", "ethereum"]);
  assert.deepEqual(matches[0].issuers, [{ projectId: "backed", relation: "issuer" }]);
});

test("a malformed asset never shortens a full page and truncates the catalog", async () => {
  const good = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      asset_id: `${prefix}-${index}`,
      addresses: [{ chain_id: "solana", token_address: `mint-${prefix}-${index}` }],
    }));
  const { stub, seen } = jsonStub((url) => {
    const offset = Number(url.searchParams.get("offset"));
    /* A full first page carrying one row the schema rejects: the page is
       still full, so paging must continue. */
    if (offset === 0)
      return { data: [{ asset_id: 42 }, ...good("a", TOKEN_TERMINAL.pageSize - 1)] };
    return { data: good("b", 7) };
  });
  const assets = await fetchAssets({}, { apiKey: KEY, fetch: stub });
  assert.equal(seen.length, 2, "the second page must still be requested");
  assert.equal(assets.length, TOKEN_TERMINAL.pageSize - 1 + 7);
  assert.ok(assets.some((asset) => asset.asset_id === "b-6"));
});

test("a caller with its own credential never reads or poisons the shared cache", async () => {
  const catalog = (assetId: string, mint: string) => ({
    data: [{ asset_id: assetId, symbol: "AX", addresses: [{ chain_id: "solana", token_address: mint }] }],
  });
  const first = issuerRepresentations("xstocks")[0].mint;
  const second = issuerRepresentations("xstocks")[1].mint;
  let goodCalls = 0;
  let badCalls = 0;
  const { stub: good } = jsonStub((url) => {
    if (url.pathname === "/v2/assets") {
      goodCalls += 1;
      return url.searchParams.get("offset") === "0" ? catalog("a1", first) : { data: [] };
    }
    return { data: [{ asset_id: "a1", metrics: {} }] };
  });
  const { stub: other } = jsonStub((url) => {
    if (url.pathname === "/v2/assets") {
      badCalls += 1;
      return url.searchParams.get("offset") === "0" ? catalog("b1", second) : { data: [] };
    }
    return { data: [{ asset_id: "b1", metrics: {} }] };
  });
  const a = await tokenTerminalCoverage({ apiKey: "KEY-A", fetch: good });
  const b = await tokenTerminalCoverage({ apiKey: "KEY-B", fetch: other });
  assert.ok(goodCalls > 0 && badCalls > 0, "each credential must issue its own request");
  assert.equal(a.status, "AVAILABLE");
  assert.equal(b.status, "AVAILABLE");
  // Different catalogs, so the two must not report the same matched mint.
  assert.equal(a.mintsMatched, 1);
  assert.equal(b.mintsMatched, 1);
  assert.notEqual(a.detail, "");
});

test("the catalog is paged to the end, with a bearer key on every request", async () => {
  const page = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => ({
      asset_id: `${prefix}-${index}`,
      addresses: [{ chain_id: "solana", token_address: `mint-${prefix}-${index}` }],
    }));
  const { stub, seen } = jsonStub((url) => {
    const offset = Number(url.searchParams.get("offset"));
    return { data: offset === 0 ? page(TOKEN_TERMINAL.pageSize, "a") : page(3, "b") };
  });
  const assets = await fetchAssets({}, { apiKey: KEY, fetch: stub });
  assert.equal(assets.length, TOKEN_TERMINAL.pageSize + 3);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].authorization, `Bearer ${KEY}`);
  assert.ok(seen[0].url.startsWith(`${TOKEN_TERMINAL.baseUrl}/v2/assets?`));
  assert.equal(new URL(seen[1].url).searchParams.get("offset"), String(TOKEN_TERMINAL.pageSize));
});

test("with no key, nothing is requested and the reason names the plan", async () => {
  let called = false;
  const stub = (async () => {
    called = true;
    return Response.json({});
  }) as typeof fetch;
  await assert.rejects(
    () => fetchAssets({}, { apiKey: null, fetch: stub }),
    (error: TokenTerminalError) => error.kind === "MISSING_KEY",
  );
  assert.equal(called, false);

  const coverage = await tokenTerminalCoverage({ apiKey: null });
  assert.equal(coverage.status, "NOT_CONFIGURED");
  assert.equal(coverage.keyConfigured, false);
  assert.equal(coverage.mintsMatched, null);
  assert.equal(coverage.catalogAssets, null);
  assert.equal(coverage.mintsQueried, 2_212);
  assert.match(coverage.detail, /API plan/);
  assert.match(coverage.detail, /TOKENTERMINAL_API_KEY/);
  for (const issuer of Object.values(coverage.byIssuer)) assert.equal(issuer.matched, null);
});

test("metrics come back grouped by asset, and an absent metric stays null", async () => {
  const { stub, seen } = jsonStub(() => ({
    data: [
      {
        asset_id: "nvidia-xstock",
        metrics: {
          [TOKEN_TERMINAL_METRICS.marketCap]: { latest: 71_078_274 },
          [TOKEN_TERMINAL_METRICS.holders]: { latest: 95_129 },
        },
      },
      // Asked for, answered without the metrics this key cannot read.
      { asset_id: "quiet-asset", metrics: {} },
      { asset_id: null },
    ],
  }));
  const metrics = await assetMetrics(["nvidia-xstock", "quiet-asset"], { apiKey: KEY, fetch: stub });
  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].marketCapUsd, 71_078_274);
  assert.equal(metrics[0].holders, 95_129);
  assert.equal(metrics[0].transferVolumeUsd, null);
  assert.equal(metrics[1].marketCapUsd, null);

  const body = JSON.parse(seen[0].body!);
  assert.equal(body.group_by, "assets");
  assert.deepEqual(body.asset_ids, ["nvidia-xstock", "quiet-asset"]);
  assert.ok(body.metric_ids.includes(TOKEN_TERMINAL_METRICS.marketCap));
  assert.ok(seen[0].url.endsWith("/v2/assets/nvidia-xstock/metrics-breakdown"));
  // An empty request is never sent.
  assert.deepEqual(await assetMetrics([], { apiKey: KEY, fetch: stub }), []);
});

test("a breakdown for an unknown asset surfaces the refusal rather than an empty result", async () => {
  const { stub } = jsonStub(() => new Response('{"code":"NOT_FOUND"}', { status: 404 }));
  await assert.rejects(
    () => fetchAssetBreakdown("missing", { metricIds: ["asset_price"], assetIds: ["missing"] }, { apiKey: KEY, fetch: stub }),
    (error: TokenTerminalError) => error.kind === "NOT_FOUND",
  );
});

test("issuer coverage sums only what came back, and says so when nothing is listed", async () => {
  const xstocks = issuerRepresentations("xstocks").slice(0, 2);
  const { stub } = jsonStub((url) => {
    if (url.pathname === "/v2/assets")
      return {
        data: url.searchParams.get("offset") === "0"
          ? [
              { asset_id: "a1", symbol: "AX", reference_asset_id: "sp500", addresses: [{ chain_id: "solana", token_address: xstocks[0].mint }] },
              { asset_id: "a2", symbol: "BX", reference_asset_id: "sp500", addresses: [{ chain_id: "solana", token_address: xstocks[1].mint }] },
            ]
          : [],
      };
    return {
      data: [
        { asset_id: "a1", metrics: { [TOKEN_TERMINAL_METRICS.marketCap]: { latest: 100 }, [TOKEN_TERMINAL_METRICS.holders]: { latest: 10 } } },
        { asset_id: "a2", metrics: { [TOKEN_TERMINAL_METRICS.marketCap]: { latest: 50 } } },
      ],
    };
  });
  // No `fresh`: a caller with its own key and fetch must bypass the shared
  // catalog cache entirely rather than read or poison another credential's.
  const coverage = await issuerExternalCoverage("xstocks", { apiKey: KEY, fetch: stub });
  assert.equal(coverage.status, "available");
  assert.equal(coverage.mintsMapped, 2);
  assert.equal(coverage.mintsQueried, issuerRepresentations("xstocks").length);
  const value = (id: string) => coverage.measures.find((measure) => measure.id === id)!.value;
  assert.equal(value("ttAssets"), 2);
  assert.equal(value("ttMarketCap"), 150);
  assert.equal(value("ttHolders"), 10);
  // No asset reported transfer volume, so the total is unavailable, not zero.
  assert.equal(value("ttTransferVolume"), null);
  assert.equal(value("ttReference"), 1);

  const { stub: emptyStub } = jsonStub(() => ({ data: [] }));
  const none = await issuerExternalCoverage("ondo", { apiKey: KEY, fetch: emptyStub });
  assert.equal(none.status, "unavailable");
  assert.equal(none.mintsMapped, 0);
  assert.match(none.reason!, /lists none of this issuer's verified mints/);
});

test("with no key, issuer coverage is dark for the stated reason and asks nothing", async () => {
  let called = false;
  const stub = (async () => {
    called = true;
    return Response.json({ data: [] });
  }) as typeof fetch;
  const coverage = await issuerExternalCoverage("backpack", { apiKey: null, fetch: stub });
  assert.equal(coverage.status, "not_configured");
  assert.equal(coverage.measures.length, 0);
  assert.equal(coverage.mintsQueried, issuerRepresentations("backpack").length);
  assert.match(coverage.reason!, /API plan/);
  assert.equal(called, false);
});
