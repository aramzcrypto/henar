import { test } from "node:test";
import assert from "node:assert/strict";
import { equityForTicker } from "../src/lib/equities/registry";
import {
  backpackRoutes,
  type BackpackSnapshot,
} from "../src/lib/equities/providers/backpack-primary";
import { bestNetRoute, capabilitiesFor } from "../src/lib/equities/routes";
import { normalizeKamino } from "../src/lib/equities/earn/kamino";
import { regularSessionStatus } from "../src/lib/equities/market-hours";
import type { EquityRoute } from "../src/lib/equities/types";
const equity = equityForTicker("NVDA")!;
const backpack = equity.representations.find((r) => r.provider === "backpack")!;
const snapshot: BackpackSnapshot = {
  assets: [
    {
      symbol: "NVDA.US",
      tokens: [
        {
          blockchain: "Solana",
          contractAddress: backpack.mint,
          depositEnabled: true,
          withdrawEnabled: true,
        },
      ],
    },
  ],
  securities: [
    { asset: "NVDA.US", sessions: [{ name: "US_EQUITIES_REGULAR" }] },
  ],
  markets: [],
  checkedAt: "2026-09-13T10:00:00Z",
};
test("Backpack requires exact Solana mint and securities intersection, not ticker listings", () => {
  assert.equal(backpackRoutes(backpack, { ...snapshot, assets: [] }).length, 0);
  assert.equal(
    backpackRoutes(backpack, { ...snapshot, securities: [] }).length,
    0,
  );
  assert.equal(
    backpackRoutes({ ...backpack, mint: "wrong" }, snapshot).length,
    0,
  );
  assert.equal(
    backpackRoutes({ ...backpack, providerStatus: "unavailable" }, snapshot)
      .length,
    0,
  );
  const routes = backpackRoutes(backpack, snapshot);
  assert.deepEqual(
    routes.map((r) => r.routeType),
    ["PRIMARY_MINT", "PRIMARY_REDEEM", "RFQ", "RFQ"],
  );
  assert.ok(
    routes.every(
      (r) => r.availability === "requires_connection" && r.quote === null,
    ),
  );
  assert.equal(bestNetRoute(routes, "buy", "10000"), null);
});
test("Backpack conversion flags honor disabled deposits and withdrawals independently", () => {
  const routes = backpackRoutes(backpack, {
    ...snapshot,
    assets: [
      {
        ...snapshot.assets[0],
        tokens: [{ ...snapshot.assets[0].tokens[0], withdrawEnabled: false }],
      },
    ],
  });
  assert.equal(routes[0].availability, "unavailable");
  assert.equal(routes[1].availability, "requires_connection");
  const capabilities = capabilitiesFor(backpack, routes, [], true);
  assert.equal(capabilities.tradeCapabilities.primaryMint, false);
  assert.equal(capabilities.tradeCapabilities.primaryRedeem, true);
  assert.equal(capabilities.marketCapabilities.afterHoursTrading, false);
});
function quote(
  id: string,
  output: string,
  type: EquityRoute["routeType"] = "DEX",
): EquityRoute {
  return {
    ...backpackRoutes(backpack, snapshot)[0],
    id,
    routeType: type,
    side: "buy",
    availability: "available",
    quote: {
      inputAmount: "10000",
      inputUnit: "USDC",
      outputAmount: output,
      outputUnit: "displayed_share",
      effectivePrice: "200",
      fees: {
        providerFeeBps: 0,
        protocolFeeAmount: "15",
        networkFeeAmount: null,
      },
      priceImpactPct: null,
      expiresAt: "2099-01-01T00:00:00Z",
    },
  };
}
test("best route compares net delivery across route types and rejects noncomparable or missing values", () => {
  const dex = quote("dex", "49");
  const mint = quote("mint", "50", "PRIMARY_MINT");
  assert.equal(bestNetRoute([dex, mint], "buy", "10000")?.id, "mint");
  const gated = { ...mint, availability: "requires_connection" as const };
  assert.equal(bestNetRoute([dex, gated], "buy", "10000")?.id, "dex");
  assert.equal(bestNetRoute([mint], "buy", "1000"), null);
  for (const change of [
    { outputUnit: "entitlement" },
    { expiresAt: "2020-01-01" },
    { outputAmount: "NaN" },
    { effectivePrice: "0" },
    { inputUnit: "entitlement" },
  ]) {
    assert.equal(
      bestNetRoute(
        [{ ...mint, quote: { ...mint.quote!, ...change } }],
        "buy",
        "10000",
      ),
      null,
    );
  }
  assert.equal(
    bestNetRoute(
      [
        {
          ...mint,
          quote: {
            ...mint.quote!,
            fees: { ...mint.quote!.fees, providerFeeBps: null },
          },
        },
      ],
      "buy",
      "10000",
    ),
    null,
  );
});
test("Earn matches mints, converts fractional APY, and distinguishes absent rates from zero", () => {
  const xstock = equity.representations.find((r) => r.provider === "xstocks")!;
  const reserve = {
    reserve: "verified-reserve",
    liquidityTokenMint: xstock.mint,
    liquidityToken: "NVDAx",
    supplyApy: "0.048",
    totalSupply: "100",
    totalBorrow: "25",
    totalSupplyUsd: "20000",
  };
  const [opportunity] = normalizeKamino(
    equity,
    [reserve],
    "2026-09-13T10:00:00Z",
  );
  assert.equal(opportunity.currentAPY, 4.8);
  assert.equal(opportunity.utilization, 0.25);
  assert.equal(opportunity.status, "requires_verification");
  assert.equal(
    normalizeKamino(
      equity,
      [{ ...reserve, liquidityTokenMint: "impostor" }],
      "now",
    ).length,
    0,
  );
  assert.equal(
    normalizeKamino(equity, [{ ...reserve, supplyApy: null }], "now")[0]
      .currentAPY,
    null,
  );
  assert.equal(
    normalizeKamino(equity, [{ ...reserve, supplyApy: "0" }], "now")[0]
      .currentAPY,
    0,
  );
});
test("market hours handle weekends, DST, holiday closures and missing calendar", () => {
  assert.equal(
    regularSessionStatus(new Date("2026-09-13T15:00:00Z"), null).status,
    "closed",
  );
  assert.equal(
    regularSessionStatus(new Date("2026-09-14T14:00:00Z"), null).status,
    "unknown",
  );
  assert.equal(
    regularSessionStatus(new Date("2026-09-14T14:00:00Z"), []).status,
    "open",
  );
  assert.equal(
    regularSessionStatus(new Date("2026-01-05T14:00:00Z"), []).status,
    "closed",
  );
  assert.equal(
    regularSessionStatus(new Date("2026-09-07T15:00:00Z"), [
      {
        market: "US_EQUITIES",
        date: "2026-09-07",
        timezone: "America/New_York",
        startTime: null,
        endTime: null,
      },
    ]).status,
    "closed",
  );
});
