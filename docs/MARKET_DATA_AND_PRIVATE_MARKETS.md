# Pyth Pro, PreStocks and Tessera — 16 September 2026

Henar extends from public tokenized markets to public **and** private
tokenized markets, on one company-first interface and one router.

    COMPANY-FIRST MARKETS
      ├── PUBLIC   xStocks / Backpack / Ondo   → Pyth Pro references + Henar routes
      └── PRIVATE  PreStocks / Tessera         → provider marks + onchain state + Henar routes
                                    │
                            HENAR ROUTER → EXECUTION GUARD → SAFE EXECUTION

Nothing here replaces existing infrastructure. The router, its two-leg paths
and residual handling, the simulation gate, protected submission, the RFQ
abstraction, Token-2022 inspection and DBC Studio are all reused as they are.

## 1. Asset taxonomy

`src/lib/assets/taxonomy.ts` names four classes: `CRYPTO`, `PUBLIC_EQUITY`,
`ETF`, `PRIVATE_MARKET_EXPOSURE`. Inside the router, `RouterRepresentation`
carries `assetClass`, so a private-market product is never handled as an
equity and the two classes cannot be confused at any layer.

Private-market products are modelled as a company with **exposure products**,
not as shares:

    PrivateCompany (OpenAI)
      ├── PreStocks OPENAI    mint PreweJYE…  SPV-backed price-tracking token
      └── Tessera   T-OpenAI  mint oPAiAikW…  loan participation right

Two products that reference one company are two different products. They are
grouped for reading and never merged, never substituted, and never summed.

## 2. Pyth Pro

Server-side only. `PYTH_PRO_API_KEY` never reaches the browser; the client
talks to Henar routes, which call Pyth.

| Module | Role |
| --- | --- |
| `src/lib/pyth/config.ts` | Endpoints, cache windows, every quality and deviation threshold |
| `src/lib/pyth/catalog.ts` | Public symbology (`pyth.dourolabs.app/v1/symbols`), hourly |
| `src/lib/pyth/feeds.ts` | Verified Henar ↔ Pyth mappings with their evidence |
| `src/lib/pyth/client.ts` | REST client; typed errors for 401 / 403 / 404 / 429 / 5xx / malformed |
| `src/lib/pyth/price.ts` | Latest-price normalization and freshness |
| `src/lib/pyth/history.ts` | History API, TradingView bars, gaps preserved |
| `src/lib/pyth/fair-value.ts` | The Fair Value Engine (pure) |
| `src/lib/pyth/coverage.ts` | Entitlement and coverage, measured at runtime |
| `src/lib/pyth/stream.ts` | WebSocket source for the worker, REST fallback for requests |
| `src/lib/pyth/decimal-math.ts` | Exact rational arithmetic; no floats on any reference |

### Feed mapping

A mapping is never made on ticker resemblance. Each records its evidence:

- **underlying** — `Equity.US.<TICKER>/USD`, `asset_type` equity, quoted in USD.
- **xStocks / Ondo** — the catalog description names the issuer's product line
  ("… XSTOCK", "… ONDO TOKENIZED STOCK"), and the token segment of
  `Crypto.<TOKEN>/USD` is exactly the token symbol the issuer publishes for
  that mint. Where Pyth publishes one, the `Crypto.<TOKEN>/<TICKER>.RR`
  redemption-rate feed ties the token to the same underlying ticker Henar
  groups the mint under.
- **Backpack** — Pyth publishes no Backpack feeds today; recorded as unmapped
  with that reason.

Measured coverage on 16 September 2026, with no key configured:

| | |
| --- | --- |
| Companies with a verified underlying feed | 897 / 1,339 |
| Representations with a tokenized feed | 59 / 2,212 (xStocks 50, Ondo 9, Backpack 0) |
| Redemption-rate feeds | 17 |
| Pyth catalog | 3,714 feeds; 2,022 equity; 60 tokenized-equity |

`/markets/data` renders these counts from live data. They widen with the
entitlement without any code change.

### Freshness, sessions and 24/7 tokens

Pyth carries the last price forward when a market is not producing new ones,
so freshness comes from `feedUpdateTimestamp`, never from the presence of a
price. An equity in a non-regular session reads `carried-forward`, not stale.

When the underlying market is closed and the tokenized reference is fresh,
the **tokenized reference is the execution boundary** — a stale equity close
never bounds a token that trades around the clock.

### Fair Value Engine

    Pyth underlying ─┐
    Pyth token ──────┼──► FairValueAssessment ──► Execution Guard ──► Router
    Henar route ─────┘

- **Token basis** (`tokenVsUnderlyingBps`) needs a verified conversion between
  one token and one share. Only a Pyth-published redemption rate is accepted.
  Without one the status is `COMPARABILITY_UNVERIFIED` — 1 token = 1 share is
  never assumed.
- **Execution deviation** (`routeVsTokenBps`) needs no such assumption and is
  what protects an execution.

### Execution Guard

The guard gains three checks, all inside the existing verdict — there is no
second guard:

| Check | Meaning |
| --- | --- |
| `pyth.reference` | Records the state and the reference behind it. Informational. |
| `pyth.dataQuality` | Publisher count and confidence-to-price ratio. |
| `pyth.executionDeviation` | Route price against the tokenized reference. |

`HENAR_PYTH_GUARD_MODE` is `observe` (default), `warn` or `enforce`. Only
`enforce` can refuse, and only on a deviation or a low-quality reference. A
missing, stale or unverifiable Pyth reference **never** refuses: existing
Henar rules stay authoritative. Nothing is ever reported as `PYTH_PASS`
without a reference. Path legs skip Pyth, which prices a stock, not a SOL hop.

## 3. PreStocks and Tessera

Provider catalogs are read live and normalized to the fields the APIs
actually return. Nothing is hard-coded and every mint is validated as a
Solana address before it is used.

| Provider | Endpoint | Fields used |
| --- | --- | --- |
| PreStocks | `prestocks.com/api/prestocks` | name, symbol, description, image, external_url, contract_address, markPrice, markValuation, tokenPrice, impliedValuation, supply |
| Tessera | `rest-api.tessera.pe/v1/public/token-details` | id, name, symbol, code, sector, mint, markPrice, holders, markValuation |

Product semantics come from each provider's own documentation and are
attributed to it. PreStocks describes tokens that track a pre-IPO company's
price, backed 1:1 by SPV exposure, conferring economic exposure only.
Tessera describes a T-Token as a loan participation right against a dedicated
issuer entity, redeemable on a qualifying liquidity event. Henar repeats
those descriptions; it does not call either product a share.

A **provider mark is not an executable market price**. The two are shown side
by side, and the difference is reported as a premium or discount, never as an
arbitrage and never with a claim that the market must converge to the mark.

### Onchain enrichment (read 16 September 2026)

| | PreStocks | Tessera |
| --- | --- | --- |
| Token program | Token-2022 | Token-2022 |
| Decimals | 9 | 9 |
| Transfer fee | 50 bps | 20 bps |
| Other extensions | PermanentDelegate, PausableConfig, ScaledUiAmount, ConfidentialTransferMint + fee config, TransferHook (no program), DefaultAccountState, MetadataPointer, TokenMetadata | TransferFeeConfig, MetadataPointer, TokenMetadata |
| Products verified | 8 | 3 |

Extension id 16 (`ConfidentialTransferFeeConfig`) is not named by the
installed `@solana/spl-token`; it is named explicitly in
`token-extensions.ts`, corroborated by the RPC's own jsonParsed decode of the
same mints. Without that, every PreStocks mint read as carrying an unknown
extension and was refused.

### Token-2022 transfer fees

Previously any non-zero transfer fee made a mint unsupported. Both providers'
products carry one, so the policy is now: **the fee is recorded, and the
guard admits a fee-bearing mint only through venues whose quotes are net of
it** (`transferFee.accounted`, `ExecutionPolicy.transferFeeNetVenues`).

Verified live on 16 September 2026 for the tOpenAI-USDC DLMM pair: Meteora's
`swapQuote` and Jupiter's quote both returned 1,080,668,345 base units for
1,000 USDC — identical to the unit, and both transfer-fee-excluded. Raydium
and Orca net the fee through their SDKs and expose it. Meteora DAMM v2
deliberately quotes without token info, and DBC has not been checked, so
neither may route a fee-bearing mint.

## 4. Private markets in the router

`scripts/router/discover-private-markets.ts` (`npm run router:discover:private`)
reads both provider catalogs, verifies every mint through the router's own
inspection, finds each product's Meteora DLMM pools by scanning the DLMM
program at the LbPair mint offsets, and confirms each pool through Meteora's
data API. It writes:

- `src/data/router/private-markets.json` — the products the router may know
- `src/data/router/mints.json` — verified mint facts
- `src/data/router/pools.json` — DLMM pool records, `DISCOVERED`
- `src/data/router/non-routable-pairs.json` — pairs indexed but never routed

Registry invariants are unchanged: only USDC routes, routing legs through a
qualified intermediate, and intermediates' own USDC pools are admitted.
Pairs of one private product against another are intelligence, not routes.

A DLMM decoder was added to `pool-mints.ts` (LbPair `tokenXMint` at 88,
`tokenYMint` at 120, confirmed against the live tOpenAI-USDC pair), so these
pools verify their own pair on chain rather than staying `DISCOVERED`.

Result on 16 September 2026: **11 products, 182 pool records, 35 enabled and
`ONCHAIN_VERIFIED`**. Public equity enablement is unchanged — 188 Raydium
CLMM and 98 Orca Whirlpool pools, exactly as before.

Routing is gated by `HENAR_PRIVATE_MARKETS_ROUTING`, off by default. The
engine's scope check keeps every quote to the exact mint requested, so
selecting Tessera T-OpenAI can never execute PreStocks OPENAI.

## 5. Live validation

Verified against live services on 16 September 2026:

- PreStocks API: 8 products; Tessera API: 3 products.
- All 11 mints read from mainnet: Token-2022, 9 decimals, fees as above.
- 35 pools `ONCHAIN_VERIFIED` through the existing verification pass.
- `POST /api/router/quote` for T-OpenAI: quoted from chain through Meteora
  DLMM pool `2ZWxT3ni…`, `transferFee.accounted` passing, guard `quote-only`,
  floor set, asset class `PRIVATE_MARKET_EXPOSURE`.
- Trade ticket: T-OpenAI selected, 100 USDC → 0.107850807 T-OpenAI through
  `Henar-router · meteora`, transfer fee disclosed.
- Pyth catalog and feed mapping against the live symbology API.

**Still pending, and not claimed as passed:**

- No `PYTH_PRO_API_KEY` is configured on this deployment, so no live price,
  channel-entitlement or history call has been made. Every Pyth price surface
  currently reports `NOT_CONFIGURED` and says so in the UI.
- No private-market trade has been signed and submitted on mainnet.
- `HENAR_PRIVATE_MARKETS_ROUTING` is not set in production.
- The Pyth WebSocket source is implemented but not exercised: the always-on
  worker is not deployed, so requests use the REST path.
