/**
 * PreStocks and Tessera adapters, company grouping, mark-vs-market
 * analytics and on-chain enrichment — offline. Fixtures mirror the live API
 * responses read on 16 September 2026.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { ExtensionType, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMintLen } from "@solana/spl-token";
import { normalizePreStocksCatalog, normalizePreStocksRow, isSolanaAddress } from "../src/lib/private-markets/providers/prestocks";
import { normalizeTesseraCatalog, normalizeTesseraRow } from "../src/lib/private-markets/providers/tessera";
import { companyNameFromProduct, companySlug, companyForSlug, groupByCompany } from "../src/lib/private-markets/companies";
import { deviationBps, dislocations, formatDeviation, markDeviation, valuationDeviation } from "../src/lib/private-markets/analytics";
import { displaySupply, onchainStateFromAccount } from "../src/lib/private-markets/onchain";
import { validateArtifact, type PrivateMarketsArtifact } from "../src/lib/private-markets/router-artifact";
import type { PrivateExposureProduct } from "../src/lib/private-markets/types";

const AT = "2026-09-16T06:00:00.000Z";
const OPENAI_MINT = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const T_OPENAI_MINT = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";

const PRESTOCKS_ROW = {
  name: "OpenAI PreStocks",
  symbol: "OPENAI",
  description: "OpenAI builds AI systems.\n\nOPENAI is a PreStocks issued token backed 1:1 by SPV exposure that tracks the price of the underlying private company.",
  image: "https://www.prestocks.com/logos/openai.png",
  external_url: "https://www.prestocks.com/openai",
  contract_address: OPENAI_MINT,
  markPrice: 955.435003987189,
  markValuation: 1183717374064,
  tokenPrice: 995.5592566559351,
  impliedValuation: 1233428526373,
  supply: 2826.5618173653415,
};
const TESSERA_ROW = { id: "T-OpenAI", name: "T-OpenAI", symbol: "T-OpenAI", code: "tOpenAI", sector: "Artificial Intelligence", mint: T_OPENAI_MINT, markPrice: 812.79, holders: 8259, markValuation: 950000000000 };

test("PreStocks normalization keeps only observed fields and carries provider provenance", () => {
  const p = normalizePreStocksRow(PRESTOCKS_ROW, AT)!;
  assert.equal(p.id, `prestocks:${OPENAI_MINT}`);
  assert.equal(p.provider, "prestocks");
  assert.equal(p.mint, OPENAI_MINT);
  assert.equal(p.companyId, "private:openai");
  assert.equal(p.mark?.price, 955.435003987189);
  assert.equal(p.mark?.unit, "token");
  assert.equal(p.mark?.provenance.provider, "prestocks");
  assert.equal(p.mark?.provenance.sourceType, "provider-mark");
  assert.equal(p.providerToken?.impliedValuation, 1233428526373);
  assert.equal(p.holders, null);
  assert.match(p.structure.type, /SPV-backed/);
  assert.match(p.eligibility!.note, /not available in the U.S./);
  // Nothing describes the product as a share of the company.
  assert.doesNotMatch(`${p.structure.type} ${p.structure.description}`, /\bshares? of\b|\bequity in\b/i);
});

test("Tessera normalization keeps mark, holders and sector; publishes no token price of its own", () => {
  const p = normalizeTesseraRow(TESSERA_ROW, AT)!;
  assert.equal(p.id, `tessera:${T_OPENAI_MINT}`);
  assert.equal(p.companyId, "private:openai");
  assert.equal(p.mark?.price, 812.79);
  assert.equal(p.holders, 8259);
  assert.equal(p.sector, "Artificial Intelligence");
  assert.equal(p.providerToken, null);
  assert.match(p.structure.type, /Loan participation/i);
  assert.match(p.structure.description, /loan participation right/i);
});

test("a dynamically added product is picked up; an invalid mint or malformed row is rejected with a reason", () => {
  const added = { ...PRESTOCKS_ROW, name: "Brand New PreStocks", symbol: "BRANDNEW", contract_address: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd" };
  const { products, rejected } = normalizePreStocksCatalog([PRESTOCKS_ROW, added, { ...PRESTOCKS_ROW, contract_address: "not-an-address" }, { nonsense: true }], AT);
  assert.equal(products.length, 2);
  assert.ok(products.some((p) => p.symbol === "BRANDNEW"));
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /not a Solana address|schema/);
  assert.equal(isSolanaAddress("not-an-address"), false);
  assert.equal(isSolanaAddress(OPENAI_MINT), true);
  const t = normalizeTesseraCatalog([TESSERA_ROW, { ...TESSERA_ROW, mint: "bad" }], AT);
  assert.equal(t.products.length, 1);
  assert.equal(t.rejected.length, 1);
});

test("missing mark or valuation leaves the field absent rather than zero", () => {
  const noMark = normalizePreStocksRow({ ...PRESTOCKS_ROW, markPrice: null, markValuation: null }, AT)!;
  assert.equal(noMark.mark, null);
  const partial = normalizePreStocksRow({ ...PRESTOCKS_ROW, markValuation: null }, AT)!;
  assert.equal(partial.mark?.price, PRESTOCKS_ROW.markPrice);
  assert.equal(partial.mark?.valuation, undefined);
  const noHolders = normalizeTesseraRow({ ...TESSERA_ROW, holders: null }, AT)!;
  assert.equal(noHolders.holders, null);
});

test("company grouping puts both providers' products under one company while keeping them distinct", () => {
  const products = [normalizePreStocksRow(PRESTOCKS_ROW, AT)!, normalizeTesseraRow(TESSERA_ROW, AT)!, normalizePreStocksRow({ ...PRESTOCKS_ROW, name: "SpaceX PreStocks", symbol: "SPACEX", contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh" }, AT)!];
  const companies = groupByCompany(products);
  assert.equal(companies.length, 2);
  const openai = companyForSlug(companies, "openai")!;
  assert.equal(openai.name, "OpenAI");
  assert.deepEqual(openai.providers, ["prestocks", "tessera"]);
  assert.equal(openai.exposureProducts.length, 2);
  // Distinct mints, distinct ids, distinct symbols: never merged into one.
  assert.equal(new Set(openai.exposureProducts.map((p) => p.mint)).size, 2);
  assert.notEqual(openai.exposureProducts[0].id, openai.exposureProducts[1].id);
  assert.deepEqual(openai.exposureProducts.map((p) => p.symbol), ["OPENAI", "T-OpenAI"]);
  assert.equal(companyNameFromProduct("prestocks", "Figure AI PreStocks", "FIGUREAI"), "Figure AI");
  assert.equal(companyNameFromProduct("tessera", "T-SpaceX", "T-SpaceX"), "SpaceX");
  assert.equal(companySlug("Figure AI"), "figure-ai");
});

const product = (over: Partial<PrivateExposureProduct> = {}): PrivateExposureProduct => ({ ...normalizePreStocksRow(PRESTOCKS_ROW, AT)!, ...over });
const execution = (price: string | null): PrivateExposureProduct["execution"] => ({ status: price ? "available" : "unavailable", referencePrice: price, referenceUiPrice: price, bestRoute: "meteora via jupiter", venues: ["Meteora DLMM"], priceImpactPct: "0.004", henarFeeBps: 10, transferFeeBps: 50, quotedAt: AT, reason: price ? null : "no verified route", provenance: { source: "Henar Router", provider: "henar-router", sourceType: "router-quote", observedAt: AT } });

test("mark-vs-market: premium from the executable route, then the provider token price, never when a figure is missing", () => {
  const withRoute = markDeviation(product({ execution: execution("1050") }));
  assert.equal(withRoute.priceSource, "henar-route");
  assert.equal(withRoute.priceDeviationBps, deviationBps(1050, PRESTOCKS_ROW.markPrice));
  assert.ok(withRoute.priceDeviationBps! > 900 && withRoute.priceDeviationBps! < 1000);
  assert.equal(withRoute.comparable, true);
  const withProvider = markDeviation(product());
  assert.equal(withProvider.priceSource, "provider-token");
  assert.equal(withProvider.priceDeviationBps, deviationBps(PRESTOCKS_ROW.tokenPrice, PRESTOCKS_ROW.markPrice));
  const noMark = markDeviation(product({ mark: null }));
  assert.equal(noMark.priceDeviationBps, null);
  assert.equal(noMark.comparable, false);
  assert.match(noMark.reason!, /no mark price/);
  const noPrice = markDeviation(product({ providerToken: null, execution: execution(null) }));
  assert.equal(noPrice.priceDeviationBps, null);
  assert.match(noPrice.reason!, /no token price/);
  // Tessera publishes no token price, so without a route there is nothing to compare.
  const tessera = markDeviation(normalizeTesseraRow(TESSERA_ROW, AT)!);
  assert.equal(tessera.priceDeviationBps, null);
  assert.equal(tessera.valuationDeviationBps, null);
});

test("valuation deviation needs both figures; formatting is a percentage of the mark", () => {
  assert.equal(valuationDeviation(product()), deviationBps(PRESTOCKS_ROW.impliedValuation, PRESTOCKS_ROW.markValuation));
  assert.equal(valuationDeviation(product({ providerToken: null })), null);
  assert.equal(deviationBps(110, 100), 1000);
  assert.equal(deviationBps(0, 100), null);
  assert.equal(deviationBps(100, 0), null);
  assert.equal(formatDeviation(1000), "+10.00%");
  assert.equal(formatDeviation(-250), "-2.50%");
  assert.equal(formatDeviation(null), "—");
});

test("dislocation rows sort comparable products first, largest absolute deviation leading", () => {
  const names = new Map([["private:openai", "OpenAI"]]);
  const rows = dislocations([product({ id: "a", execution: execution("1200") }), product({ id: "b", execution: execution("960") }), product({ id: "c", mark: null, providerToken: null, execution: execution(null) })], names);
  assert.deepEqual(rows.map((r) => r.productId), ["a", "b", "c"]);
  assert.equal(rows[0].companyName, "OpenAI");
  assert.equal(rows[0].referenceSource, "henar-route");
  assert.equal(rows[2].comparable, false);
});

// --- on-chain enrichment ------------------------------------------------

function mintAccount(owner: PublicKey, decimals: number, supply: bigint, extensions: { type: ExtensionType; payload: Buffer }[] = []) {
  const isT22 = owner.equals(TOKEN_2022_PROGRAM_ID);
  const len = isT22 ? Math.max(getMintLen(extensions.map((e) => e.type)), 166 + extensions.reduce((n, e) => n + 4 + e.payload.length, 0)) : MINT_SIZE;
  const data = Buffer.alloc(len);
  MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: new PublicKey(Buffer.alloc(32, 3)), supply, decimals, isInitialized: true, freezeAuthorityOption: 1, freezeAuthority: new PublicKey(Buffer.alloc(32, 4)) }, data);
  if (isT22) {
    data[165] = 1;
    let offset = 166;
    for (const ext of extensions) {
      data.writeUInt16LE(ext.type, offset);
      data.writeUInt16LE(ext.payload.length, offset + 2);
      ext.payload.copy(data, offset + 4);
      offset += 4 + ext.payload.length;
    }
  }
  return { owner, data, executable: false, lamports: 1, rentEpoch: 0 };
}
const feePayload = (bps: number) => {
  const p = Buffer.alloc(108);
  p.writeUInt16LE(bps, 88);
  p.writeUInt16LE(bps, 106);
  return p;
};

test("onchain enrichment reads Token-2022 facts: transfer fee, authorities, supply and router support", () => {
  const account = mintAccount(TOKEN_2022_PROGRAM_ID, 9, 684825114702n, [{ type: ExtensionType.TransferFeeConfig, payload: feePayload(20) }, { type: ExtensionType.MetadataPointer, payload: Buffer.alloc(64) }]);
  const state = onchainStateFromAccount(T_OPENAI_MINT, account, 447_000_000, AT);
  assert.equal(state.status, "verified");
  assert.equal(state.isToken2022, true);
  assert.equal(state.decimals, 9);
  assert.equal(state.transferFeeBps, 20);
  assert.equal(state.supplyRaw, "684825114702");
  assert.equal(state.supplyUi, "684.825114702");
  assert.equal(state.routerSupported, true);
  assert.equal(state.freezeAuthority, new PublicKey(Buffer.alloc(32, 4)).toBase58());
  assert.equal(state.slot, 447_000_000);
  assert.equal(state.provenance.provider, "solana");
  // A legacy Token mint is equally fine and carries no extensions.
  const legacy = onchainStateFromAccount(OPENAI_MINT, mintAccount(TOKEN_PROGRAM_ID, 6, 1000n), 1, AT);
  assert.equal(legacy.isToken2022, false);
  assert.deepEqual(legacy.extensions, []);
  assert.equal(legacy.transferFeeBps, null);
});

test("a transfer hook makes a private-market mint unsupported for routing, with the reason kept", () => {
  const hook = Buffer.alloc(64);
  new PublicKey(Buffer.alloc(32, 7)).toBuffer().copy(hook, 32);
  const state = onchainStateFromAccount(T_OPENAI_MINT, mintAccount(TOKEN_2022_PROGRAM_ID, 9, 1n, [{ type: ExtensionType.TransferHook, payload: hook }]), 1, AT);
  assert.equal(state.routerSupported, false);
  assert.match(state.unsupportedReason!, /transfer hook/);
});

test("display supply applies a scaled-UI multiplier when the mint carries one", () => {
  assert.equal(displaySupply(1_901_955_332_424n, 9, null), "1901.955332424");
  assert.equal(displaySupply(1_000_000_000n, 9, "1"), "1");
  assert.equal(displaySupply(1_000_000_000n, 9, "1.4861347"), "1.4861347");
  assert.equal(displaySupply(0n, 9, null), "0");
});

test("the router artifact refuses a bad mint, an unknown provider or a duplicate", () => {
  const good: PrivateMarketsArtifact = { generatedAt: AT, sources: {}, products: [{ provider: "tessera", providerProductId: "T-OpenAI", symbol: "T-OpenAI", name: "T-OpenAI", mint: T_OPENAI_MINT, companySlug: "openai", companyName: "OpenAI", sourceUrl: "", discoveredAt: AT }] };
  assert.deepEqual(validateArtifact(good), []);
  assert.ok(validateArtifact({ ...good, products: [{ ...good.products[0], mint: "nope" }] }).some((p) => /base58/.test(p)));
  assert.ok(validateArtifact({ ...good, products: [{ ...good.products[0], provider: "other" as never }] }).some((p) => /unknown provider/.test(p)));
  assert.ok(validateArtifact({ ...good, products: [good.products[0], good.products[0]] }).some((p) => /duplicate/.test(p)));
  assert.ok(validateArtifact({ ...good, products: [{ ...good.products[0], companySlug: "" }] }).some((p) => /companySlug/.test(p)));
});
