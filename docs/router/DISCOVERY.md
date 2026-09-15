# Pool discovery — venue-native, deterministic

15 September 2026. Every figure counted from `src/data/router/*-discovery.json`.

## The dependency that was removed

Before:

```
Jupiter route plan at build time -> discover-from-jupiter -> pool ENABLED
```

Registry membership depended on what one aggregator happened to route during
one deployment. Consequences, all observed:

- production coverage varied between deploys;
- the committed snapshot (Raydium only) did not describe what was live;
- an Orca NVDAx pool reached production with no trace in the snapshot;
- every pool an RFQ path bypasses was invisible — and JupiterZ bypasses
  essentially all of them, so the registry learned almost nothing.

After: venue-native discovery decides membership. Jupiter forensics still runs,
but only informs where to look. A pool whose sole provenance is
`JUPITER_FORENSICS` is recorded, measured, and **never enabled**.

`prebuild` no longer runs Jupiter discovery. It verifies the committed registry
on chain and nothing else, so two deploys of the same commit produce the same
pool set.

## Provenance

`discoverySources` on every record, from a closed set:

`RAYDIUM_API`, `RAYDIUM_ONCHAIN`, `ORCA_API`, `ORCA_ONCHAIN`,
`METEORA_API`, `METEORA_ONCHAIN`, `JUPITER_FORENSICS`.

`venueNativeDiscovery(sources)` is the enablement gate: every source except
forensics is authoritative. Pools found by several passes are deduplicated on
address and keep all provenance.

## Orca — the inconsistency, resolved

Orca's HTTP index answers **403** to an ordinary integrator, which is also why
`orcaLiquidity` reported "Orca pool data unavailable". Discovery therefore
reads the program directly: one filtered scan for 653-byte Whirlpool accounts,
decoded with the official SDK, joined locally against the verified mint set.

| Metric | Value |
| --- | --- |
| Whirlpool accounts on chain | 158,573 |
| Touching a verified representation mint | **801** |
| Representations covered | **110** |

Deterministic by construction: output is sorted by (stock mint, pool address)
and deduplicated on address, so two runs against the same chain state differ
only in `fetchedAt`.

## Coverage by representation family

| Provider | Pools | Representations | With a USDC pool | With a non-USDC pool |
| --- | --- | --- | --- | --- |
| xStocks | 640 | 60 | 55 | 43 |
| Backpack | 122 | 31 | 29 | 14 |
| **Ondo** | **39** | **19** | **11** | **11** |

**This corrects the earlier Ondo classification.** Ondo was reported as
`NO_PUBLIC_SOLANA_LIQUIDITY` on the evidence that Raydium and Meteora held zero
pools for its mints, with Orca explicitly recorded as *unverified* because its
index returned 403. With Orca read from chain, Ondo has 39 pools across 19
representations, 11 of them USDC-paired. The correct classification is
`DISCOVERY_MISSING`: the liquidity existed and the pipeline could not see it.

## Counter-assets

| Counter | Pools |
| --- | --- |
| USDC | 277 |
| SOL | 120 |
| (pump-style token) `71664H6w…` | 23 |
| `27G8MtK7…` | 18 |
| `2FprjEk4…` | 13 |
| USDT | 12 |
| cbBTC | 11 |
| `FKU35pM9…` | 10 |

- **120 SOL-paired pools** hold a verified stock mint. The current registry
  build rejects every non-USDC pair outright, so none are recorded today.
- **15 representations have an Orca pool but no USDC-paired one** — their only
  public Orca liquidity is against something else.
- **60 representations have more than one USDC-paired Orca pool**, which is the
  first time split routing has had anything to split across: 58 of 100
  representations in the Raydium-only registry had exactly one enabled pool.

Discovery intelligence only. No graph routing is built, and the many
stock/pump-token pairs are infrastructure rather than routes — the existing
`STOCK_PAIRED_INFRASTRUCTURE` eligibility class already covers that case.

## Commands

```bash
npm run router:discover:orca        # ORCA_ONCHAIN, needs SOLANA_RPC_URL
npm run router:discover:raydium     # RAYDIUM_API
npm run router:discover:meteora     # METEORA_ONCHAIN, needs SOLANA_RPC_URL
npm run router:discover:dbc         # DBC + DAMM v2, needs SOLANA_RPC_URL
npm run router:pools:build          # discovery dumps -> pools.json
npm run router:verify:pools         # sets ONCHAIN_VERIFIED
npm run router:discover:jupiter     # forensics only; never enables
```

## Follow-up: external-route protections are not the router's

`EXTERNAL_EXECUTABLE` routes execute through `/api/market`, which validates the
transaction byte for byte — one signer, mints and amounts matched to the
reviewed quote, the fee instruction atomic with the swap, `platformFee`
asserted zero, minOut enforced, representation fixed. What it does **not**
apply is the Router Execution Guard.

Pool verification cannot apply to an RFQ fill, but these should be consistent
across both paths and currently are not:

- quote freshness and state-slot age
- representation verification
- reference-price divergence
- market-session checks
- amount and mint integrity beyond the reviewed quote

Not addressed here; discovery only. Tracked so the gap is visible rather than
implicit in which path a route happens to take.
