import test from "node:test";
import assert from "node:assert/strict";
import { stockReceipts } from "../src/lib/stock-receipts";
import type { ProtocolView } from "../src/lib/protocol/view";
const data = {
  stocks: [{ mint: "stock", decimals: 8 }],
  positions: [
    {
      address: "yield",
      owner: "me",
      kind: { earn: {} },
      destination: { packs: {} },
      stockMint: "new-target",
      stockUnitsReceived: "123",
      stockUsdcSpent: "10000000",
    },
    {
      address: "order",
      owner: "me",
      kind: { limit: {} },
      stockUnitsReceived: "123",
      stockUsdcSpent: "10000000",
    },
  ],
  packs: [
    {
      address: "opened",
      owner: "me",
      stockMint: "stock",
      status: { settled: {} },
      source: { earned: {} },
      unitsReceived: "90071992547409931",
    },
    {
      address: "pending",
      owner: "me",
      stockMint: "stock",
      status: { selected: {} },
      source: { purchased: {} },
      unitsReceived: "1",
    },
    {
      address: "other",
      owner: "other",
      stockMint: "stock",
      status: { settled: {} },
      source: { purchased: {} },
      unitsReceived: "1",
    },
  ],
} as unknown as ProtocolView;
test("Stockfolio uses only confirmed owned pack receipts and preserves exact units", () => {
  const receipts = stockReceipts(data, "me");
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].source, "Yield pack");
  assert.equal(receipts[1].units, "90071992547409931");
});
test("changed yield destinations do not reattribute historical stocks to a new mint", () => {
  assert.deepEqual(stockReceipts(data, "me")[0], {
    address: "yield",
    value: "10000000",
    source: "Yield",
  });
  assert.deepEqual(stockReceipts(null, "me"), []);
  assert.deepEqual(stockReceipts(data), []);
});
