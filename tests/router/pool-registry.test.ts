import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USDC_MINT,
  buildPoolRegistry,
  isOnchainVerified,
  listRouterRepresentations,
  loadPoolRegistry,
  poolsForRepresentation,
  validatePool,
  type VerifiedPool,
} from "@henar/router-core";

const rep = listRouterRepresentations()[0];

function pool(overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  return {
    id: "raydium:49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
    representationId: rep.id,
    mint: rep.mint,
    provider: rep.provider,
    tokenSymbol: rep.tokenSymbol,
    venue: "raydium",
    address: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
    programId: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    poolType: "clmm",
    baseMint: rep.mint,
    quoteMint: USDC_MINT,
    feeBps: 10,
    feeConfig: { tickSpacing: 10 },
    observedTokenPrograms: null,
    tvlUsd: 2_000_000,
    discoveredFrom: "test",
    discoveredAt: "2026-09-15T00:00:00.000Z",
    verifiedAt: "2026-09-15T00:00:00.000Z",
    verification: "DISCOVERED",
    onchainVerifiedAt: null,
    verificationDetail: null,
    eligibility: "ROUTER_ELIGIBLE",
    dbc: null,
    enabled: true,
    disabledReason: null,
    ...overrides,
  };
}

test("committed pools.json loads, and every entry pairs a registry mint with USDC", () => {
  const registry = loadPoolRegistry();
  const known = new Set(listRouterRepresentations().map((r) => r.id));
  for (const p of registry.pools) {
    assert.deepEqual(validatePool(p), [], p.address);
    assert.ok(known.has(p.representationId), `${p.address} names unknown representation`);
  }
  for (const p of registry.pools.filter((p) => p.enabled)) {
    assert.equal(p.poolType, "clmm", "only CLMM has a direct adapter today");
    assert.ok((p.tvlUsd ?? 0) >= 1000, "enabled pools meet the TVL floor");
  }
});

test("pools that do not pair with USDC are rejected", () => {
  assert.ok(validatePool(pool({ quoteMint: "So11111111111111111111111111111111111111112" })).some((m) => /USDC/.test(m)));
  assert.ok(validatePool(pool({ baseMint: USDC_MINT })).some((m) => /identical/.test(m)));
  assert.ok(validatePool(pool({ mint: "11111111111111111111111111111111", baseMint: "11111111111111111111111111111111" })).length === 0);
  assert.ok(validatePool(pool({ address: "not-base58!" })).some((m) => /base58/.test(m)));
});

test("verification state and timestamp cannot disagree; DISCOVERED is never onchain-verified", () => {
  assert.equal(isOnchainVerified(pool()), false);
  assert.ok(validatePool(pool({ onchainVerifiedAt: "2026-09-15T00:00:00.000Z" })).some((m) => /carries onchainVerifiedAt/.test(m)));
  assert.ok(validatePool(pool({ verification: "ONCHAIN_VERIFIED" })).some((m) => /without onchainVerifiedAt/.test(m)));
  assert.ok(validatePool(pool({ verification: "VERIFICATION_FAILED", verificationDetail: "mint mismatch" })).some((m) => /is enabled/.test(m)));
  assert.deepEqual(validatePool(pool({ verification: "VERIFICATION_FAILED", verificationDetail: "mint mismatch", enabled: false, disabledReason: "verification failed" })), []);
  const verified = pool({ verification: "ONCHAIN_VERIFIED", onchainVerifiedAt: "2026-09-15T00:00:00.000Z" });
  assert.deepEqual(validatePool(verified), []);
  assert.equal(isOnchainVerified(verified), true);
  // Committed registry: nothing is chain-verified yet on this machine.
  for (const p of loadPoolRegistry().pools) {
    assert.equal(p.verification, "DISCOVERED", p.address);
    assert.equal(isOnchainVerified(p), false);
  }
});

test("enabled/disabled must carry a consistent reason", () => {
  assert.ok(validatePool(pool({ enabled: true, disabledReason: "x" })).length);
  assert.ok(validatePool(pool({ enabled: false, disabledReason: null })).length);
  assert.deepEqual(validatePool(pool({ enabled: false, disabledReason: "thin" })), []);
});

test("buildPoolRegistry rejects duplicates and indexes by representation", () => {
  assert.throws(() => buildPoolRegistry([pool(), pool()]), /Duplicate/);
  const registry = buildPoolRegistry([
    pool(),
    pool({ id: "x", address: "2Yd9LsuDU5gnCUWd7XT6i29HsXXTUQfuuNhZDQjWgi6p", enabled: false, disabledReason: "thin" }),
  ]);
  assert.equal(poolsForRepresentation(rep.id, { registry }).length, 1);
  assert.equal(poolsForRepresentation(rep.id, { registry, includeDisabled: true }).length, 2);
  assert.equal(poolsForRepresentation(rep.id, { registry, venue: "meteora" }).length, 0);
  assert.equal(poolsForRepresentation("unknown", { registry }).length, 0);
});
