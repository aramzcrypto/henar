/**
 * The registry is an artifact, so its invariants are testable without RPC.
 *
 * Registry membership used to depend on what Jupiter happened to route during
 * a build, which made production coverage vary between deployments. These
 * assertions are the ones that would have caught that: provenance gates
 * enablement, the order is a pure function of the contents, and no pool
 * appears twice however many discovery passes found it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { USDC_MINT, venueNativeDiscovery, isQualifiedIntermediate } from "@henar/router-core";

type Entry = {
  id: string;
  address: string;
  venue: string;
  programId: string;
  mint: string;
  baseMint: string;
  quoteMint: string;
  representationId: string;
  eligibility: string;
  enabled: boolean;
  disabledReason: string | null;
  tvlUsd: number | null;
  discoverySources?: string[];
};

const REGISTRY: Entry[] = JSON.parse(
  readFileSync("src/data/router/pools.json", "utf8"),
);

const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const MIN_TVL_USD = 1_000;

test("registry has no duplicate pools, however many passes discovered them", () => {
  const ids = REGISTRY.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate registry id");
  const addresses = REGISTRY.map((p) => p.address);
  assert.equal(new Set(addresses).size, addresses.length, "duplicate pool address");
});

test("registry order is a pure function of its contents", () => {
  // The build sorts by representation, then by TVL descending. Re-sorting a
  // copy must reproduce the file exactly, or two builds can disagree on order
  // while agreeing on contents.
  const resorted = [...REGISTRY].sort((a, b) =>
    a.representationId === b.representationId
      ? (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)
      : a.representationId.localeCompare(b.representationId),
  );
  assert.deepEqual(
    resorted.map((p) => p.id),
    REGISTRY.map((p) => p.id),
  );
});

test("a pool known only from Jupiter forensics is never enabled", () => {
  for (const pool of REGISTRY) {
    if (!pool.enabled) continue;
    const sources = pool.discoverySources;
    // Older entries predate provenance; a missing field must not be read as
    // "venue-native", so the assertion is on what is present.
    if (!sources) continue;
    assert.ok(
      venueNativeDiscovery(sources as never),
      `${pool.id} is enabled with sources ${sources.join(",")}`,
    );
    assert.ok(
      !(sources.length === 1 && sources[0] === "JUPITER_FORENSICS"),
      `${pool.id} is enabled on forensics alone`,
    );
  }
});

test("every enabled pool is a USDC route or a routing leg, above the floor", () => {
  for (const pool of REGISTRY.filter((p) => p.enabled)) {
    const mints = [pool.baseMint, pool.quoteMint];
    assert.ok(mints.includes(pool.mint), `${pool.id} does not hold its own mint`);
    assert.ok(
      pool.tvlUsd !== null && pool.tvlUsd >= MIN_TVL_USD,
      `${pool.id} enabled with TVL ${pool.tvlUsd}`,
    );
    /* Two kinds of enabled pool, and nothing else. A direct route pairs the
       representation with USDC. A routing leg pairs it with an approved
       intermediate and can only ever be one leg of a multi-leg route, which
       the guard enforces by refusing it for a direct quote. An enabled pool
       that is neither would be an unapproved asset inside an automatic
       route. */
    if (pool.eligibility === "ROUTER_ELIGIBLE") {
      assert.ok(mints.includes(USDC_MINT), `${pool.id} is not USDC-paired`);
      continue;
    }
    /* The third kind: an approved intermediate's own USDC pool, the USDC-side
       hop of a path. Its mint is the intermediate, and it belongs to no equity. */
    if (pool.eligibility === "INTERMEDIATE_ROUTE") {
      assert.ok(mints.includes(USDC_MINT), `${pool.id} intermediate route is not USDC-paired`);
      assert.ok(isQualifiedIntermediate(pool.mint), `${pool.id} intermediate ${pool.mint} is not approved`);
      assert.equal(pool.representationId, `intermediate:${pool.mint}`);
      continue;
    }
    assert.equal(pool.eligibility, "ROUTING_LEG", `${pool.id} eligibility`);
    assert.ok(!mints.includes(USDC_MINT), `${pool.id} is a USDC route, not a leg`);
    const counter = mints.find((m) => m !== pool.mint)!;
    assert.ok(isQualifiedIntermediate(counter), `${pool.id} routes through ${counter}, which is not an approved intermediate`);
  }
});

test("a pair outside the approved set never reaches the executable registry", () => {
  /* The registry now holds routing legs as well as USDC routes, so the old
     rule that every entry is USDC-paired no longer holds. What must still
     hold is that nothing else gets in: a pool pairing a representation with
     an arbitrary token is intelligence, kept in its own artifact, and an
     automatic route must never pass through it. */
  for (const pool of REGISTRY) {
    const counter = [pool.baseMint, pool.quoteMint].find((m) => m !== pool.mint);
    assert.ok(
      counter === USDC_MINT || isQualifiedIntermediate(counter!),
      `${pool.id} reached the executable registry paired with ${counter}`,
    );
  }
  const intelligence = JSON.parse(
    readFileSync("src/data/router/non-routable-pairs.json", "utf8"),
  ) as { pools: { counterMint: string; status: string }[] };
  // Venue-native discovery is only worth the work if it finds what the old
  // pipeline could not: this set must not be empty.
  assert.ok(intelligence.pools.length > 0, "no non-USDC liquidity recorded at all");
  for (const pool of intelligence.pools) {
    assert.equal(pool.status, "DISCOVERED_NON_ROUTABLE_PAIR");
    assert.notEqual(pool.counterMint, USDC_MINT);
  }
});

test("Orca entries carry the Whirlpool program and onchain provenance", () => {
  const orca = REGISTRY.filter((p) => p.venue === "orca");
  assert.ok(orca.length > 0, "no Orca pools in the registry");
  for (const pool of orca) {
    assert.equal(pool.programId, ORCA_WHIRLPOOL_PROGRAM, `${pool.id} program`);
    assert.deepEqual(pool.discoverySources, ["ORCA_ONCHAIN"], `${pool.id} provenance`);
  }
});
