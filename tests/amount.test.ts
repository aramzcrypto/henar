import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits, formatUnits, feeFor } from "../src/lib/amount";
import { stockFor, stocks } from "../src/lib/registry";
test("USDC decimal input remains exact beyond floating-point precision", () => {
  assert.equal(parseUnits("9007199254.740993", 6), 9007199254740993n);
  assert.equal(formatUnits(9007199254740993n, 6), "9007199254.740993");
});
test("rejects negative, exponent, excess precision, nonfinite and u64 overflow", () => {
  for (const input of ["-1", "1e6", "NaN", "0.0000001", "18446744073710", ""])
    assert.throws(() => parseUnits(input, 6));
});
test("fees round down to base units", () => {
  assert.equal(feeFor(parseUnits("10", 6), 200), 200000n);
  assert.equal(feeFor(399n), 0n);
  assert.equal(feeFor(400n), 1n);
});
test("formatting handles zero and small Token-2022 units", () => {
  assert.equal(formatUnits(0n, 8), "0");
  assert.equal(formatUnits(1n, 8), "0.00000001");
});
test("registry rejects symbols and unknown mints", () => {
  assert.throws(() => stockFor("NVDA"));
  assert.throws(() => stockFor("So11111111111111111111111111111111111111112"));
  assert.equal(stockFor(stocks[0].mint).ticker, "NVDAx");
  assert.equal(new Set(stocks.map((s) => s.mint)).size, stocks.length);
});

test("each offered issuer uses explicit, valid Solana mint addresses", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  for (const stock of stocks) {
    assert.equal(new PublicKey(stock.mint).toBase58(), stock.mint);
    assert.ok(["xStocks", "Ondo", "Backpack"].includes(stock.provider));
    assert.ok(
      stock.source.startsWith(
        stock.provider === "Ondo"
          ? "https://github.com/ondoprotocol/"
          : stock.provider === "Backpack"
            ? "https://api.backpack.exchange/"
            : "https://xstocks.com/",
      ),
    );
  }
});
