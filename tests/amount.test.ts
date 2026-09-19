import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits, formatUnits, feeFor } from "../src/lib/amount";
import { stockFor, stocks } from "../src/lib/registry";
import { sourceForMint } from "@/lib/stock-sources";
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
    /* Provenance lives in stock-sources.json so it is not shipped to browsers
       with the catalog. Every catalogued mint must still have one, or the
       split has quietly dropped data. */
    assert.ok(sourceForMint(stock.mint), `no source recorded for ${stock.ticker}`);
    assert.ok(["xStocks", "Ondo", "Backpack"].includes(stock.provider));
    assert.ok(
      sourceForMint(stock.mint)!.startsWith(
        stock.provider === "Ondo"
          ? "https://github.com/ondoprotocol/"
          : stock.provider === "Backpack"
            ? "https://api.backpack.exchange/"
            : "https://xstocks.com/",
      ),
    );
  }
});

/* Price impact is rendered beside formatted percentages, and a raw float
   ("0.05048302673706992%") stood out among them. Rounding alone is not enough:
   a real impact under a hundredth of a percent must not print as "0.00%",
   which reads as no impact at all. */
test("price impact formats to two decimals and never rounds a real impact to zero", async () => {
  const { formatPriceImpact } = await import("@/lib/format-impact");
  assert.equal(formatPriceImpact(0.0005048302673706992), "0.05%");
  assert.equal(formatPriceImpact(0.1234), "12.34%");
  assert.equal(formatPriceImpact(0), "0.00%");
  assert.equal(formatPriceImpact(0.00000001), "<0.01%", "tiny but real is not zero");
  assert.equal(formatPriceImpact(-0.00000001), ">-0.01%");
  assert.equal(formatPriceImpact(Number.NaN), "—");
  assert.equal(formatPriceImpact(Number.POSITIVE_INFINITY), "—");
});
