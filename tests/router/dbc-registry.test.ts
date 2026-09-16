/**
 * Registry rules for DBC / DAMM v2 records: eligibility is derived from the
 * pair, infrastructure records never route, DBC identity survives
 * graduation, and malformed records are rejected at load.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USDC_MINT,
  buildPoolRegistry,
  listDbcPools,
  listInfrastructurePools,
  listRouterRepresentations,
  loadPoolRegistry,
  poolsForRepresentation,
  validatePool,
  type VerifiedPool,
} from "@henar/router-core";

const rep = listRouterRepresentations()[0];
import { PublicKey } from "@solana/web3.js";
const key = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const LAUNCH = key(31);
const DBC_POOL = key(32);
const DAMM_POOL = key(33);
const CONFIG = key(34);

function dbcPool(overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  return {
    id: `meteora-dbc:${DBC_POOL}`,
    representationId: rep.id,
    mint: rep.mint,
    provider: rep.provider,
    tokenSymbol: rep.tokenSymbol,
    venue: "meteora-dbc",
    address: DBC_POOL,
    programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    poolType: "dbc",
    baseMint: rep.mint,
    quoteMint: USDC_MINT,
    feeBps: 100,
    feeConfig: { configId: CONFIG },
    observedTokenPrograms: null,
    tvlUsd: null,
    discoveredFrom: "test",
    discoveredAt: "2026-09-15T00:00:00.000Z",
    verifiedAt: "2026-09-15T00:00:00.000Z",
    verification: "DISCOVERED",
    onchainVerifiedAt: null,
    verificationDetail: null,
    eligibility: "ROUTER_ELIGIBLE",
    dbc: {
      configAddress: CONFIG,
      lifecycle: "BONDING",
      lifecycleCheckedAt: null,
      lifecycleSlot: null,
      successorStatus: "NOT_APPLICABLE",
      successorPoolAddress: null,
      successorConfirmedAt: null,
    },
    enabled: true,
    disabledReason: null,
    ...overrides,
  };
}

test("router-eligible DBC (stock base, USDC quote) validates and routes while BONDING", () => {
  assert.deepEqual(validatePool(dbcPool()), []);
  const registry = buildPoolRegistry([dbcPool()]);
  assert.equal(poolsForRepresentation(rep.id, { registry, venue: "meteora-dbc" }).length, 1);
  assert.equal(listInfrastructurePools({ registry }).length, 0);
});

test("stock-paired DBC (launch token priced in the stock) is infrastructure: kept, monitored, never routed", () => {
  const infra = dbcPool({
    baseMint: LAUNCH,
    quoteMint: rep.mint,
    eligibility: "STOCK_PAIRED_INFRASTRUCTURE",
    enabled: false,
    disabledReason: "STOCK_PAIRED_INFRASTRUCTURE: not a USDC↔equity route",
  });
  assert.deepEqual(validatePool(infra), []);
  const registry = buildPoolRegistry([infra]);
  assert.equal(poolsForRepresentation(rep.id, { registry }).length, 0);
  assert.equal(poolsForRepresentation(rep.id, { registry, includeDisabled: true }).length, 1);
  assert.equal(listInfrastructurePools({ registry, representationId: rep.id })[0]?.address, DBC_POOL);
  assert.equal(listDbcPools(registry).length, 1);

  // It cannot be promoted by flipping flags: eligibility is derived from the pair.
  assert.ok(validatePool({ ...infra, enabled: true, disabledReason: null }).some((m) => /cannot be enabled/.test(m)));
  assert.ok(validatePool({ ...infra, eligibility: "ROUTER_ELIGIBLE", enabled: true, disabledReason: null }).some((m) => /does not pair with USDC/.test(m)));
});

test("a USDC pair cannot hide as infrastructure", () => {
  assert.ok(validatePool(dbcPool({ eligibility: "STOCK_PAIRED_INFRASTRUCTURE", enabled: false, disabledReason: "x" })).some((m) => /must be ROUTER_ELIGIBLE/.test(m)));
});

test("DBC lifecycle rules: only BONDING may be enabled; GRADUATED must resolve a successor; successor fields agree", () => {
  assert.ok(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, lifecycle: "MIGRATING" } })).some((m) => /MIGRATING cannot be enabled/.test(m)));
  assert.deepEqual(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, lifecycle: "MIGRATING" }, enabled: false, disabledReason: "DBC lifecycle MIGRATING" })), []);
  assert.ok(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, lifecycle: "GRADUATED" }, enabled: false, disabledReason: "graduated" })).some((m) => /must resolve a successor/.test(m)));
  const graduated = dbcPool({
    dbc: { ...dbcPool().dbc!, lifecycle: "GRADUATED", successorStatus: "CONFIRMED", successorPoolAddress: DAMM_POOL, successorConfirmedAt: "2026-09-15T00:00:00.000Z" },
    enabled: false,
    disabledReason: "DBC lifecycle GRADUATED",
  });
  assert.deepEqual(validatePool(graduated), []);
  // The DBC record keeps its own address/venue after graduation.
  assert.equal(graduated.venue, "meteora-dbc");
  assert.equal(graduated.address, DBC_POOL);
  assert.ok(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, successorStatus: "CONFIRMED" } })).some((m) => /without successorPoolAddress/.test(m)));
  assert.ok(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, successorPoolAddress: DAMM_POOL } })).some((m) => /carries successorPoolAddress/.test(m)));
  assert.ok(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, lifecycle: "GRADUATED", successorStatus: "UNRESOLVED" }, enabled: false, disabledReason: "g" })).length === 0);
});

test("malformed DBC records are rejected: missing dbc block, dbc block on a non-DBC pool, bad config address", () => {
  assert.ok(validatePool(dbcPool({ dbc: null })).some((m) => /dbc pool without dbc record/.test(m)));
  assert.ok(validatePool(dbcPool({ poolType: "damm_v2", venue: "meteora-damm-v2" })).some((m) => /non-dbc pool carries a dbc record/.test(m)));
  assert.ok(validatePool(dbcPool({ dbc: { ...dbcPool().dbc!, configAddress: "nope" } })).some((m) => /configAddress is not base58/.test(m)));
  assert.throws(() => buildPoolRegistry([dbcPool({ dbc: null })]), /Invalid pool/);
});

test("the committed registry carries a known eligibility on every pool and no DBC records yet", () => {
  /* Three eligibilities are in the file: USDC routes, routing legs, and the
     intermediates' own USDC pools (the USDC-side hop of a path). The
     assertion is that every pool declares one of them, not that they are all
     the same one, which stopped being true when SOL and USDT legs were
     admitted. Infrastructure pairs remain outside the registry entirely. */
  for (const p of loadPoolRegistry().pools) {
    assert.ok(
      p.eligibility === "ROUTER_ELIGIBLE" || p.eligibility === "ROUTING_LEG" || p.eligibility === "INTERMEDIATE_ROUTE",
      `${p.address} eligibility ${p.eligibility}`,
    );
    assert.equal(p.dbc, null, p.address);
  }
  assert.equal(listDbcPools().length, 0);
  assert.equal(listInfrastructurePools().length, 0);
});
