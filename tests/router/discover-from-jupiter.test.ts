import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesFromRoutePlan, venueFamilyForLabel } from "@henar/router-app";

test("route-plan labels map to Henar venue families; unknown AMMs and RFQ are ignored", () => {
  assert.equal(venueFamilyForLabel("Raydium CLMM"), "raydium");
  assert.equal(venueFamilyForLabel("Meteora DLMM"), "dlmm");
  assert.equal(venueFamilyForLabel("Meteora DAMM v2"), "damm_v2");
  assert.equal(venueFamilyForLabel("JupiterZ"), null);
  assert.equal(venueFamilyForLabel("OKX DEX Router"), null);
  assert.equal(venueFamilyForLabel("BisonFi"), null);
  assert.equal(venueFamilyForLabel("Raydium CPMM"), null);
  assert.equal(venueFamilyForLabel(null), null);
});

test("candidates are keyed by pool with the first family seen; steps without a pool are skipped", () => {
  const c = candidatesFromRoutePlan([
    { venue: "Meteora DLMM", pool: "4RXAgdnL9QJrrZBJuUcjmZk2KodatKXazijaUnmkbsWE", percent: 12.28 },
    { venue: "BisonFi", pool: "8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo", percent: 16.99 },
    { venue: "Raydium CLMM", pool: "Ev938MFPsbPECgKn4EUnqPPq87cXHdCTd2YErJjaxy2f", percent: 100 },
    { venue: "Raydium CLMM", pool: null, percent: 70 },
    { venue: "JupiterZ", pool: "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa", percent: 100 },
  ]);
  assert.deepEqual([...c.entries()], [
    ["4RXAgdnL9QJrrZBJuUcjmZk2KodatKXazijaUnmkbsWE", "dlmm"],
    ["Ev938MFPsbPECgKn4EUnqPPq87cXHdCTd2YErJjaxy2f", "raydium"],
  ]);
});
