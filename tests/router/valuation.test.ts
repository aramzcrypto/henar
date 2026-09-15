/**
 * Pool valuation: the old estimate doubled the USDC vault, which assumes both
 * sides hold equal value. A Whirlpool's range can sit entirely on one side of
 * the market, so that assumption understates a stock-heavy pool and overstates
 * a USDC-heavy one — by an unbounded factor in both directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { valueWhirlpool } from "@henar/router-core";

const usdc = (whole: number) => BigInt(Math.round(whole * 1_000_000));
/** 8-decimal equity mint, as xStocks and Backpack both use. */
const shares = (whole: number) => BigInt(Math.round(whole * 1e8));

test("balanced pool: both sides valued, not one side doubled", () => {
  const result = valueWhirlpool({
    usdcRawAmount: usdc(50_000),
    stockRawAmount: shares(250),
    stockDecimals: 8,
    scaledUiMultiplier: 1,
    referencePriceUsd: 200,
  });
  assert.equal(result.method, "USDC_VAULT_PLUS_STOCK_AT_REFERENCE");
  // 50,000 USDC + 250 shares x $200 = 100,000.
  assert.equal(result.tvlUsd, 100_000);
});

test("stock-heavy pool: doubling USDC would have understated it", () => {
  const result = valueWhirlpool({
    usdcRawAmount: usdc(100),
    stockRawAmount: shares(500),
    stockDecimals: 8,
    scaledUiMultiplier: 1,
    referencePriceUsd: 200,
  });
  // Truth: 100 + 100,000 = 100,100. Old estimate: 2 x 100 = 200.
  assert.equal(result.tvlUsd, 100_100);
  assert.ok(result.tvlUsd! > 2 * 100, "old estimate was 500x too small");
});

test("USDC-heavy pool: doubling USDC would have overstated it", () => {
  const result = valueWhirlpool({
    usdcRawAmount: usdc(100_000),
    stockRawAmount: shares(1),
    stockDecimals: 8,
    scaledUiMultiplier: 1,
    referencePriceUsd: 200,
  });
  // Truth: 100,000 + 200 = 100,200. Old estimate: 200,000.
  assert.equal(result.tvlUsd, 100_200);
  assert.ok(result.tvlUsd! < 2 * 100_000);
});

test("Token-2022 scaled amounts: the multiplier converts raw to priced units", () => {
  const raw = shares(100);
  const plain = valueWhirlpool({
    usdcRawAmount: 0n,
    stockRawAmount: raw,
    stockDecimals: 8,
    scaledUiMultiplier: 1,
    referencePriceUsd: 10,
  });
  const scaled = valueWhirlpool({
    usdcRawAmount: 0n,
    stockRawAmount: raw,
    stockDecimals: 8,
    scaledUiMultiplier: 2,
    referencePriceUsd: 10,
  });
  // The same raw balance is worth twice as much after a 2x multiplier, which
  // is exactly what a split does: raw is unchanged, display units double.
  assert.equal(plain.tvlUsd, 1_000);
  assert.equal(scaled.tvlUsd, 2_000);
});

test("no reference price: unavailable, never guessed", () => {
  for (const price of [null, 0, -5, Number.NaN]) {
    const result = valueWhirlpool({
      usdcRawAmount: usdc(5_000),
      stockRawAmount: shares(10),
      stockDecimals: 8,
      scaledUiMultiplier: 1,
      referencePriceUsd: price,
    });
    assert.equal(result.method, "UNAVAILABLE", `price ${price}`);
    assert.equal(result.tvlUsd, null, `price ${price}`);
    // A caller must not be able to read a number out of an unavailable result.
    assert.match(result.detail, /reference price/);
  }
});

test("unverified decimals or multiplier: unavailable", () => {
  assert.equal(
    valueWhirlpool({
      usdcRawAmount: usdc(5_000),
      stockRawAmount: shares(10),
      stockDecimals: null,
      scaledUiMultiplier: 1,
      referencePriceUsd: 200,
    }).method,
    "UNAVAILABLE",
  );
  assert.equal(
    valueWhirlpool({
      usdcRawAmount: usdc(5_000),
      stockRawAmount: shares(10),
      stockDecimals: 8,
      scaledUiMultiplier: 0,
      referencePriceUsd: 200,
    }).method,
    "UNAVAILABLE",
  );
});

test("a pool below the floor is valued honestly, not rounded up", () => {
  const result = valueWhirlpool({
    usdcRawAmount: usdc(120),
    stockRawAmount: shares(2),
    stockDecimals: 8,
    scaledUiMultiplier: 1,
    referencePriceUsd: 200,
  });
  // 120 + 400 = 520: real, and still under the $1,000 floor.
  assert.equal(result.tvlUsd, 520);
  assert.ok(result.tvlUsd! < 1_000);
});
