# Meteora DBC + DAMM v2 in the Henar Router

Status: DBC-1 … DBC-17 implemented and validated offline, 15 September 2026.
**LIVE VALIDATION PENDING** — no RPC on this machine. DBC-18 … DBC-23
(monitoring UI, Studio) not started.

## Three Meteora programs, three venues

| Venue id           | Program                                        | SDK                                        | Adapter                         |
|--------------------|------------------------------------------------|--------------------------------------------|---------------------------------|
| `meteora`          | DLMM `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | `@meteora-ag/dlmm` 1.9.14                   | `@henar/venue-meteora`          |
| `meteora-dbc`      | DBC `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`  | `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12 | `@henar/venue-meteora-dbc`      |
| `meteora-damm-v2`  | cp-amm `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | `@meteora-ag/cp-amm-sdk` 1.4.8              | `@henar/venue-meteora-damm-v2`  |

A DBC graduates into DAMM v2, never into DLMM. Each adapter filters on its
own venue id and program id; a registry record can only ever reach the
adapter it was written for (tested: a DAMM v2 record handed to the DLMM
adapter is `NO_VERIFIED_POOL`).

## Routing scope is unchanged

The equity engine still supports exactly `USDC ↔ verified representation`.
A DBC market is classified from its pair (`scripts/router/build-pool-registry.ts`):

| Pair                            | `eligibility`                    | `enabled` | Reaches engine |
|---------------------------------|----------------------------------|-----------|----------------|
| {registry mint, USDC}           | `ROUTER_ELIGIBLE`                | while BONDING | yes        |
| {launch token, registry mint}   | `STOCK_PAIRED_INFRASTRUCTURE`    | never     | no             |
| neither side a registry mint    | rejected at build                | —         | —              |

`validatePool` derives the rule from the mints, so an infrastructure record
cannot be promoted by editing flags, and a USDC pair cannot hide as
infrastructure. Infrastructure records are reachable only through
`listInfrastructurePools()` / `listDbcPools()` for monitoring and the Studio.

## Lifecycle (from program state only)

Decided by `classifyDbcLifecycle` from `PoolState` + `PoolConfig`
(Meteora account docs: `migration_progress` "0 pre-bonding curve, 1
post-bonding curve, 2 locked vesting, 3 created pool"; `is_migrated`
0/1):

| Condition                                                   | State      | Adapter result     |
|-------------------------------------------------------------|------------|--------------------|
| `is_migrated == 1` or `migration_progress == 3`             | GRADUATED  | `POOL_GRADUATED`   |
| `migration_progress ∈ {1, 2}`                               | MIGRATING  | `ROUTE_MIGRATING`  |
| `quote_reserve ≥ migration_quote_threshold` (curve complete)| MIGRATING  | `ROUTE_MIGRATING`  |
| `current_point < activation_point`                          | PAUSED     | `POOL_INACTIVE`    |
| `migration_progress == 0`, reserve below threshold          | BONDING    | quote              |
| any other value                                             | UNKNOWN    | `POOL_INACTIVE`    |

Reserve proximity is never used: 99.9 % of threshold is BONDING (tested).
At exactly the threshold the SDK itself throws "Virtual pool is completed";
the adapter reports `ROUTE_MIGRATING` and the metadata shows
`graduationProgressBps: 10000`.

`refreshDbcLifecycle(connection, pool)` is the single refresh routine used
by the adapter path, `scripts/router/refresh-dbc-lifecycle.ts`, and the
future monitor. It resolves the successor only when GRADUATED.

## DBC → DAMM v2 successor

`resolveDammV2Successor`: derive `deriveDammV2PoolAddress(dammConfig,
baseMint, quoteMint)` with `dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[
migration_fee_option]` (published for options 0–5), read the account, and
CONFIRM only if it is owned by the DAMM v2 program and its two mints are
exactly the DBC pair. `Customizable` (option 6) has no published config;
an operator-supplied `successorHint` is verified the same way, else the
record is `UNRESOLVED` with the reason. Nothing is inferred from timing or
reserves. After graduation the DBC record keeps its own address, venue and
config; `dbc.successorPoolAddress` links to the DAMM v2 record, which is a
separate `meteora-damm-v2` pool in the same registry.

## Quoting

Both adapters are thin wrappers over official SDK quote functions:

- DBC: `swapQuoteExactIn(pool, config, swapBaseForQuote, amountIn, 0,
  hasReferral=false, currentPoint, eligibleForFirstSwapWithMinFee=false)`.
  First-swap-min-fee is assumed *off* so a quote never exceeds what the
  program will pay. Price impact is derived from the SDK's pre-trade sqrt
  price in integer Q128 math.
- DAMM v2: `swapQuoteExactInput(pool, currentPoint, amountIn, 0, aToB,
  false, decA, decB)`; price impact is the SDK's own figure, floored to bps.

Tests validate every normalized amount against the SDK on the same
synthetic state with **zero tolerance** (integer equality); synthetic
state is itself produced by the SDK (`buildCurveWithMarketCap`,
`getSqrtPriceFromPrice`, `cpAmmCoder` fee encoding).

Normalization uses the existing `VenueQuote` + `FeeBreakdown`; venue
metadata lives under `rawRouteMetadata` with `kind: "meteora-dbc" |
"meteora-damm-v2"` (`DbcQuoteMetadata`, `DammV2QuoteMetadata`). The Henar
15 bps fee is applied once by the engine, as for every venue (tested:
venue sees 99.85 USDC of a 100 USDC buy).

## Token-2022

`inspectionFromAccount` / `inspectMint` (router-core) read the mint once
and decide support: legacy Token and plain Token-2022 are supported;
`TransferFeeConfig` only at 0 bps; `TransferHook`, `NonTransferable`,
`PermanentDelegate`, frozen `DefaultAccountState` → unsupported →
`UNSUPPORTED_TOKEN_EXTENSION`. `ScaledUiAmountConfig` is supported and the
multiplier is exposed as display metadata only; every settlement amount
stays raw (tested: a ×2 multiplier changes nothing in the quote). DBC
`token_type` and DAMM v2 `token_a_flag`/`token_b_flag` must agree with the
mint programs read from chain, else `QUOTE_TERMS_MISMATCH`.

Transfer-hook DBC pools (`swap2_with_transfer_hook`) are therefore not
quoted or built; that is a policy limitation, not an SDK one.

## Instruction preparation (DBC-13 / DBC-14)

`buildSwapInstructions(quote, ctx, { owner, minimumAmountOut })` builds
`swap2` ExactIn through each SDK and returns unsigned instructions. It
refuses unless the venue execution flag is on, the caller supplies the
owner and a guard-approved minimum, the quote is unexpired, and no
instruction requires a signer other than the owner. **Execution is off**:
`HENAR_METEORA_DBC_EXECUTION` and `HENAR_METEORA_DAMM_V2_EXECUTION` are
unset; nothing is sent anywhere.

## Feature flags

| Flag                              | Default | Effect                                   |
|-----------------------------------|---------|------------------------------------------|
| `HENAR_METEORA_DBC_QUOTES`        | off     | DBC adapter answers `VENUE_DISABLED`     |
| `HENAR_METEORA_DBC_EXECUTION`     | off     | DBC builder answers `VENUE_DISABLED`     |
| `HENAR_METEORA_DAMM_V2_QUOTES`    | off     | DAMM v2 adapter answers `VENUE_DISABLED` |
| `HENAR_METEORA_DAMM_V2_EXECUTION` | off     | DAMM v2 builder answers `VENUE_DISABLED` |
| `HENAR_DBC_STUDIO`, `HENAR_DBC_MAINNET_DEPLOY` | off | reserved for DBC-21 … DBC-23  |

## Registry additions

`VerifiedPool` gained `eligibility` and `dbc` (`DbcRegistryRecord`:
config, lifecycle, checked slot/time, successor status/address/time).
`Venue` gained `meteora-dbc` / `meteora-damm-v2`; `PoolType` gained `dbc`
/ `damm_v2`. All 310 existing Raydium records were rebuilt with
`eligibility: "ROUTER_ELIGIBLE", dbc: null`; nothing else about them
changed.

Discovery (`npm run router:discover:dbc`, RPC-gated) sweeps every DBC
virtual pool, keeps those with a registry mint on either side, classifies
lifecycle, resolves successors, and also lists DAMM v2 pools pairing a
registry mint with USDC. `npm run router:pools:build` ingests both files.
`npm run router:dbc:refresh` re-reads lifecycle/successor for every DBC
record and flips `enabled` accordingly, never deleting a record.

## What still needs RPC (other laptop)

1. `npm run router:discover:dbc` — establishes whether any stock-paired or
   USDC-paired DBC/DAMM v2 markets exist today.
2. `npm run router:pools:build` → `npm run router:dbc:refresh`.
3. Live DBC and DAMM v2 quotes via the adapters with the quote flags on
   (`npm run router:benchmark` once the adapters are added to its list).
4. Confirm `getBaseFeeNumeratorFromIncludedFeeAmount` at zero amount
   reports the base tier for rate-limiter DAMM v2 pools (fee display only;
   quotes are unaffected).
5. The on-chain verification pass (`ONCHAIN_VERIFIED`) for any admitted
   DBC/DAMM v2 record, as for every other venue.

## DBC Studio (DBC-18…23)

- **Monitor** — `monitorDbcMarket` / `monitorRegistryDbcMarkets` in
  `packages/dbc-studio/src/monitor.ts`; `GET /api/dbc/markets`. Reads through
  the router's own state code; unverifiable fields are null.
- **Configure** — `StudioMarketConfig` → `buildStudioConfig` (SDK
  `buildCurveWithMarketCap`, `validateConfigParameters`); presets are data,
  not recommendations. Deprecated modes (RateLimiter, DAMM v1) refused.
- **Model** — `recommendGraduation`: post-graduation pool modeled as
  constant-product full-range; Q = T / I; threshold = Q / (1 − fee);
  verified against the SDK's threshold for the derived caps and labelled
  MODELED / ESTIMATED with explicit caveats. `recommendFeeProfile` maps
  volatility/liquidity/maturity to a fee scheduler, validated by the SDK.
- **Review** — `reviewHash(config, pool, cluster)` over canonical JSON.
- **Deploy** — `prepareDeployment` builds the SDK's create-config-and-pool
  transaction with the wallet as payer; config and base-mint keypairs are
  generated in the browser and sign there; `validateStudioDeployment` checks
  payer, signers and programs before the wallet is asked. `/studio` UI.
- **Mainnet guard** — `HENAR_DBC_MAINNET_DEPLOY=1`, matching review hash,
  explicit acknowledgement, wallet signature. No server wallet, no auto-fund,
  no auto-deploy. Flag is unset in production.
