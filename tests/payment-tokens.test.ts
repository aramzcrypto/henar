import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENT_SOL,
  PAYMENT_USDC,
  paymentForMode,
  resolveFeeAccount,
  accountFunding,
  SOL_MINT,
} from "../src/lib/payment-tokens";
import { USDC, stocks } from "../src/lib/registry";
import { POST } from "../src/app/api/market/route";
test("market retains selected currency; yield limit and existing DCA use USDC", () => {
  assert.equal(paymentForMode("market", PAYMENT_SOL), PAYMENT_SOL);
  assert.equal(paymentForMode("limit", PAYMENT_SOL), PAYMENT_USDC);
  assert.equal(paymentForMode("dca", PAYMENT_SOL), PAYMENT_USDC);
});
test("fee collection only uses one of the swap mints", () => {
  const output = stocks[0].mint;
  assert.deepEqual(
    resolveFeeAccount(SOL_MINT, output, { [output]: "stock-fee" }, "usdc-fee"),
    { address: "stock-fee", mint: output },
  );
  assert.deepEqual(resolveFeeAccount(USDC, output, {}, "usdc-fee"), {
    address: "usdc-fee",
    mint: USDC,
  });
  assert.throws(() => resolveFeeAccount(SOL_MINT, output, {}, "usdc-fee"));
});
test("SOL principal is not displayed as rent or network fees", () => {
  assert.equal(
    accountFunding(
      2_000_000_000n,
      998_994_000n,
      6000n,
      SOL_MINT,
      1_000_000_000n,
    ),
    1_000_000n,
  );
  assert.equal(
    accountFunding(2_000_000_000n, 1_998_994_000n, 6000n, USDC, 100_000_000n),
    1_000_000n,
  );
});
test("market endpoint cannot be used to submit a yield limit request", async () => {
  const res = await POST(
    new Request("http://localhost/api/market", {
      method: "POST",
      body: JSON.stringify({
        owner: "11111111111111111111111111111111",
        mint: stocks[0].mint,
        inputMint: SOL_MINT,
        mode: "limit",
        amount: "1",
      }),
    }),
  );
  assert.equal(res.status, 400);
});
test("same-mint swaps are rejected before requesting a route", async () => {
  const res = await POST(
    new Request("http://localhost/api/market", {
      method: "POST",
      body: JSON.stringify({
        owner: "11111111111111111111111111111111",
        mint: stocks[0].mint,
        inputMint: stocks[0].mint,
        amount: "1",
      }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /different payment/);
});
