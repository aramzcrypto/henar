import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stocks } from "../src/lib/registry";
import report from "../src/data/catalog-report.json";
test("catalog counts and issuer provenance match the import report", () => {
  assert.equal(stocks.length, report.total);
  assert.equal(new Set(stocks.map((s) => s.mint)).size, stocks.length);
  for (const [issuer, count] of Object.entries(report.counts))
    assert.equal(stocks.filter((s) => s.provider === issuer).length, count);
});
test("every stock logo is bundled locally with a known image signature", () => {
  for (const stock of stocks) {
    assert.match(stock.logo, /^\/logos\/[a-f0-9]+\.(png|svg|webp|jpe?g)$/);
    const path = resolve("public", stock.logo.slice(1));
    assert.ok(existsSync(path), stock.ticker);
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 50, stock.ticker);
    assert.ok(
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.subarray(0, 4).toString() === "RIFF" ||
        bytes.toString().includes("<svg") ||
        bytes[0] === 255,
      stock.ticker,
    );
  }
});
test("leveraged and inverse products are excluded from trading", () => {
  for (const entry of report.excluded) {
    if (entry.reason === "Leveraged or inverse product")
      assert.ok(
        !stocks.some(
          (s) => s.provider === entry.provider && s.ticker === entry.ticker,
        ),
      );
  }
});

test("V1 pack candidates contain only Backpack stocks, without duplicate mints", async () => {
  const { backpackPackCandidates } = await import("../src/lib/pack-catalog");
  const candidates = backpackPackCandidates();
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(s => s.provider === "Backpack" && s.instrument === "Stock"));
  assert.equal(new Set(candidates.map(s => s.mint)).size, candidates.length);
});
