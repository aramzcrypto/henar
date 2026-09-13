import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSecResearch } from "../src/lib/equities/sec";

test("SEC records become sourced company research without inventing estimates or dates", () => {
  const research = parseSecResearch(
    "0000320193",
    {
      sicDescription: "Electronic Computers",
      addresses: { business: { city: "Cupertino", stateOrCountry: "CA" } },
      filings: {
        recent: {
          accessionNumber: ["0000320193-26-000001"],
          filingDate: ["2026-08-01"],
          form: ["10-Q"],
          primaryDocument: ["aapl-20260630.htm"],
        },
      },
    },
    {
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: {
              USD: [
                {
                  val: 300,
                  start: "2025-10-01",
                  end: "2026-06-30",
                  filed: "2026-08-01",
                  form: "10-Q",
                  fy: 2026,
                  fp: "Q3",
                },
                {
                  val: 100,
                  start: "2026-04-01",
                  end: "2026-06-30",
                  filed: "2026-08-01",
                  form: "10-Q",
                  fy: 2026,
                  fp: "Q3",
                  frame: "CY2026Q2",
                },
              ],
            },
          },
          NetIncomeLoss: {
            units: {
              USD: [
                {
                  val: 25,
                  end: "2026-06-30",
                  filed: "2026-08-01",
                  form: "10-Q",
                  fy: 2026,
                  fp: "Q3",
                },
              ],
            },
          },
          EarningsPerShareDiluted: {
            units: {
              "USD/shares": [
                {
                  val: 1.5,
                  end: "2026-06-30",
                  filed: "2026-08-01",
                  form: "10-Q",
                  fy: 2026,
                  fp: "Q3",
                },
              ],
            },
          },
          CommonStockDividendsPerShareDeclared: {
            units: {
              "USD/shares": [
                {
                  val: 0.25,
                  end: "2026-06-30",
                  filed: "2026-08-01",
                  form: "10-Q",
                },
              ],
            },
          },
        },
      },
    },
  );
  assert.equal(research.profile.data?.industry, "Electronic Computers");
  assert.equal(research.financials.data?.[0].netIncome, "25");
  assert.equal(research.earnings.data?.[0].actualEps, "1.5");
  assert.equal(research.earnings.data?.[0].estimatedEps, null);
  assert.deepEqual(research.dividends.data?.[0], {
    periodEnd: "2026-06-30",
    filedAt: "2026-08-01",
    amount: "0.25",
    currency: "USD",
  });
  assert.match(research.filings.data?.[0].url ?? "", /aapl-20260630\.htm$/);
  assert.equal(research.news.status, "unavailable");
});
