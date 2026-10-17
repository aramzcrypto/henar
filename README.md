# Henar

**Henar is the market and intelligence layer for stocks on Solana.**

> One company. Every representation. One market.

A tokenized stock exists several times over. NVIDIA is `NVDAx` on xStocks, `NVDA` on Backpack Securities, and `NVDAon` on Ondo — different mints, different token programs, different issuer mechanics, different liquidity. Every venue today asks the user to pick a token. Henar asks them to pick a company, then does the comparison work underneath.

- [Live application](https://henarapp.vercel.app)
- [Markets](https://henarapp.vercel.app/markets)

## What we are building

Henar is not a DEX for tokenized stocks. It is the layer a user goes through before and after the trade:

|              |                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Discover** | 1,339 companies and ETFs, 2,212 verified issuer mints, grouped by underlying company                                                              |
| **Research** | Financials, earnings, dividends, filings and news from SEC EDGAR; an earnings and macro calendar                                                  |
| **Compare**  | xStocks, Backpack and Ondo side by side — price, spread, liquidity, route, redemption terms, and each issuer's own backing and custody            |
| **Trade**    | Market, limit and DCA execution, priced by Henar's own routing engine against Raydium, Orca, Meteora and byreal and ranked beside the aggregators |
| **Pre-IPO**  | Private-market exposure from PreStocks and Tessera, priced against provider marks and Henar's own routes                                          |
| **Earn**     | Yield strategies that turn idle USDC into stock exposure                                                                                          |
| **Manage**   | Holdings, protocol positions and settlement receipts in one place                                                                                 |

The unit of the product is the company, not the mint. Issuer differences are preserved and surfaced where they matter — Henar normalizes the experience without claiming that one issuer's product is legally or technically the same as another's.

## Products

- **Markets** — Company-first discovery across every verified representation, public and private. Overview, a full directory with sector classification, and a calendar of earnings and macro events. Company pages carry financials, earnings, news, dividends, filings, and an Onchain tab comparing every issuer representation. The overview also compares the issuers themselves on volume and liquidity, and each one has a page covering its backing, custody and what can actually move onchain.
- **Trade** — A ranked quote list for market swaps that puts Henar's own routes in direct competition with the aggregators, plus yield-bearing limit orders and scheduled DCA purchases. Each quote carries its venue, its net output after fees, and whether it can actually be executed.
- **Earn** — A featured USDC strategy that turns yield into stock exposure, plus a directory of verified stock pools across Solana lending markets and vaults. Each pool has its own page and ticket; only the featured strategy is wired to the protocol today, and the rest are explicitly marked Coming soon.
- **Packs** — Buy or earn sealed stock packs with onchain settlement and ORAO randomness.
- **Stockfolio** — Read wallet holdings, protocol positions, sealed packs, and confirmed opening receipts.

## Routing and execution

Henar quotes Solana venues directly rather than reselling an aggregator's answer, and it only executes against liquidity it has re-read from chain.

**Venues quoted in-process.** Raydium (CLMM and CPMM), Orca Whirlpools, Meteora (DLMM, DAMM v2, DBC) and byreal each have their own adapter that prices against pool state. Jupiter, OpenOcean and a firm-RFQ adapter quote alongside them as competing candidates, so an aggregator wins a trade only when it actually returns more.

**Verified liquidity only.** The pool registry holds 1,512 catalogued pools (598 Raydium, 473 Meteora, 420 Orca, 21 byreal). 700 are `ONCHAIN_VERIFIED` in the committed snapshot, and the pass runs again on every deploy (`prebuild`), so the live count is whatever chain agreed with at build time. Verified means the pool account and both mint accounts were re-read from chain and the pair the pool actually trades was decoded from its own layout and matched against the pair the registry claims. A pool whose layout cannot be decoded stays `DISCOVERED` and cannot back a Henar-native trade. `src/data/router/mints.json` carries 2,369 verified mint records, each with the decimals, token program, Token-2022 extensions and the slot the facts were read at. Nothing is inferred or defaulted; a mint with missing facts stays unverified and is not routable.

**Route construction.** Beyond single-venue quotes the engine builds two further shapes, each reported with its own measured improvement:

- _Splits_ across at most two legs, allocated by marginal output and then refined on the boundary, so a size that moves one pool's price can take liquidity from two.
- _Two-leg paths_ through an intermediate asset, where the second hop is sized on the first hop's guaranteed floor rather than its expected output. Intermediates are not configured by hand: 157 candidates were probed with a $10,000 round trip and the 40 that lost under 100 bps qualified.

**Execution guard.** Before anything is signed, a route passes quote freshness against the current slot, a user slippage ceiling, a separate tighter ceiling on the intermediate hop of a path, and a build-and-simulate pass that constructs the real transaction and checks the simulated balance change on the exact destination token account named in the plan. Any failure demotes the route to non-selectable. Every candidate is reported with an execution capability: `HENAR_NATIVE`, `EXTERNAL_EXECUTABLE` or `QUOTE_ONLY`.

**Selection is by best obtainable net output.** The Trade quote list ranks candidates on what the user would actually receive after venue cost and the 10 bps market fee, and execution follows that ranking. The fee is applied to every candidate, including Henar's own routes, so it cannot bias the comparison. A route that prices well but is not reachable is shown and labelled, never selected.

**What the measurements say.** Henar native clears the guard on about 40% of observations overall, and that rate falls with size: on a 196-observation matrix across four sizes and both sides it was approved on 38 of 49 rows at $10 and on none at all at $50,000, where either no native venue quotes or the price impact exceeds the ceiling. Depth, not routing, is the binding constraint at size, and the aggregator wins those trades. The benchmark doc states the sample size and the failures alongside the wins, and currently withholds the head-to-head win rate: the last full run predates a fix to how Jupiter was quoted, and a figure measured against a stale comparator is not worth publishing. See [the benchmark matrix](docs/router/BENCHMARK_MATRIX_V2.md) and [architecture §10](docs/router/ARCHITECTURE.md).

## Data policy

Henar shows verified data or it shows nothing. Sector classification comes from each company's SEC-filed SIC code. Earnings come from filed XBRL facts. Prices and routes come from live quotes against exact verified mints. Where a source is not connected, the interface says so rather than estimating — "Unavailable", "Coming soon" and "External opportunity" are real states in this product, not placeholders.

## Submission status

The website is a public development preview. Market discovery and data integrations are live where a verified source is available. The custom Anchor program and settlement worker are implemented for integration testing but are not enabled for public mainnet deposits. Missing quotes, balances, APY, or issuer capabilities are shown as unavailable rather than estimated.

The candidate V1 contract manifest contains 39 Backpack stocks with matched execution requirements. Catalog membership does not guarantee liquidity, issuer eligibility, redemption access, or an executable route.

Routing is live in production: Henar quotes its own venues, ranks them against the aggregators, and native execution is enabled. The gate-by-gate record of what has actually run against mainnet, including what is still pending, is in [live validation](docs/router/LIVE_VALIDATION.md). Benchmarks in this repository are stated with their sample size and their failures, not only their wins.

## Run locally

Use Node.js 22:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Server credentials belong in `.env.local`. Private keys must never be placed in the frontend, Vercel environment, repository, or chat.

## Architecture

- Next.js application and server routes
- Anchor program for positions, DCA, Packs, and settlement controls
- An in-process routing engine: per-venue quote adapters, a verified pool and mint registry, split and path construction, and an execution guard
- Kamino vault integration for USDC yield
- ORAO randomness for Pack selection
- Exact integer accounting for token amounts and fees, with no floating point in a quote or a fee
- Wallet-bound authorization, transaction simulation, route validation, and admission limits

The routing engine is a workspace of small packages rather than one module:

|                            |                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/router-core`     | Types, pool and mint registries, on-chain pool and mint verification, pool-layout decoding, split and path construction, request caching |
| `packages/execution-guard` | Freshness, slippage and intermediate-hop policy; the verdict every route must earn                                                       |
| `packages/tx-builder`      | Transaction construction for native routes                                                                                               |
| `packages/venue-*`         | One adapter per venue: Raydium, Orca, Meteora (DLMM, DAMM v2, DBC), byreal, Jupiter, OpenOcean, RFQ                                      |
| `apps/router`              | Offline CLIs for discovery, verification, qualification and benchmarking                                                                 |

Routing behaviour is flag-gated per environment, so quoting, the quote UI, native execution, split routing and path routing can each be enabled independently.

The onchain program keeps its original internal `stockroom` identifier. This is an implementation name and does not affect the Henar product identity.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run contracts:build
```

Two generated data sets are rebuilt offline rather than fetched per request:

```sh
npm run router:discover:private  # PreStocks and Tessera products, mints and pools
npm run sectors:build         # SIC-based sector index from SEC EDGAR
npm run earnings:build        # filed results powering the calendar
npm run calendar:warm -- 200  # widen the local research cache
```

The routing registries are built the same way, offline and against chain. Discovery proposes pools, verification is the only step that can mark one usable, and qualification decides which assets may carry a second hop:

```sh
npm run router:discover:raydium   # also :orca :meteora :byreal :jupiter
npm run router:pools:build        # assemble the registry from discovery output
npm run router:verify:pools       # re-read pool and mint accounts, decode the real pair
npm run router:verify:mints       # persist decimals, token program, extensions, slot
npm run router:qualify:intermediates  # round-trip probe; only qualified assets carry a hop
npm run router:validate:build-sim # build and simulate representative native routes
npm run router:benchmark:matrix   # Henar against the aggregators across sizes and sides
```

These require an RPC endpoint in `.env.local`. The committed registries are the output of these runs, so a reviewer can rebuild them rather than take them on trust.

Routing documentation: [architecture](docs/router/ARCHITECTURE.md), [discovery](docs/router/DISCOVERY.md), [execution safety parity](docs/router/EXECUTION_SAFETY_PARITY.md), [benchmark matrix](docs/router/BENCHMARK_MATRIX_V2.md), [open items](docs/router/HANDOFF.md). Session handoff notes: [16 September 2026](docs/HANDOFF_2026-09-16.md).

The repository also contains release checks for protocol configuration, routes, transaction size, treasury accounts, and deployment planning. See [validation evidence](docs/VALIDATION.md), [mainnet setup](docs/MAINNET.md), and [security review](docs/SECURITY_REVIEW_RETEST_2026-09-13.md).

The current review and test evidence supports a hackathon preview. A funded public launch still requires deployed-binary verification, capped rollout testing, operational monitoring, and an independent smart-contract audit.
