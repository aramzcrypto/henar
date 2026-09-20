# Issuers — 20 September 2026

Henar's unit is the company. This is the other axis.

A representation is not a company's share. It is one issuer's instrument,
with its own backing, its own custody, its own chains, its own rules about
whether the token may move at all, and its own liquidity.

Those differences surface in two places, and issuers are deliberately **not**
a tab. The Markets overview carries the comparison — volume, liquidity, live
markets and holders, per issuer — and each row links to that issuer's own
page. An issuer is somewhere a reader arrives at from a figure they were
already reading, not a category they browse to.

    COMPANY AXIS    NVIDIA ──┬── NVDAx    xStocks
                             ├── NVDA     Backpack Securities
                             └── NVDAon   Ondo
    ISSUER AXIS     xStocks ─── 711 mints ─── what backs them, what trades

## 1. Four sources, four availabilities

Each block answers for itself. One failing never fills in for another, and no
block is estimated to cover a gap.

| Block | Source | Network cost |
| --- | --- | --- |
| `catalog` | Henar's verified registry | none; computed at module load |
| `market` | Jupiter, over every verified mint | the shared catalog-wide pass |
| `disclosure` | the issuer's own public API | xStocks and Backpack today |
| `external` | Token Terminal | only with an API-plan key |

`src/lib/issuers/types.ts` defines the contracts. `registry.ts` assembles a
snapshot; `profiles.ts` derives issuer identity from the registry rather than
restating it, so an issuer fact is never asserted in two places.

## 2. The catalog-wide market pass

`src/lib/equities/catalog-market.ts` reads every verified mint in one pass.
Jupiter's token search answers for a hundred mints per call, so the whole
2,212-mint catalog is about twenty-three calls with a concurrency of four —
a single cached read, not a per-request cost. It is cached for five minutes
and served stale while it refreshes.

This is the primitive three surfaces share:

- **Ranked market views** rank the universe. They used to rank the fifty
  companies they had fetched, in alphabetical order, and the interface had to
  disclose that. Most traded and most liquid now cover every match.
- **The liquidity filter** on All markets, below.
- **The issuer comparison**, which aggregates the same entries by issuer and
  therefore costs nothing extra.

Execution never reads it. `/trade` quotes fresh, every time.

## 3. What "liquid" means

`src/lib/equities/onchain-activity.ts` states the rule rather than implying
it, and the interface repeats it under the filter:

| Filter | Rule | Measured 20 September 2026 |
| --- | --- | --- |
| Traded in 24h | at least one verified mint traded | 101 of 1,339 companies |
| Liquid onchain | traded **and** holding $10,000+ of pooled liquidity | 75 companies |

`LIQUID_FLOOR_USD` is the floor, declared in one place. Depth with no trade is
not a liquid market, and a company whose mints could not be read fails the
filter rather than passing by default.

Three rules keep the filter from lying:

- **It is scoped to the selected issuer.** With a provider filter on, the fold
  covers only that issuer's mints. Otherwise a reader who had narrowed to Ondo
  would be shown a company whose xStocks token clears the floor while its Ondo
  token has no market at all — the filter answering about a token they
  excluded. Measured 20 September 2026: 75 companies are liquid overall, but
  only 26 through xStocks, 53 through Backpack and **1** through Ondo.
- **A partial read may reorder, never exclude.** Ranking a short pass just
  puts unknowns last and says the scope is incomplete. Filtering on one would
  drop companies whose batch failed, and nothing distinguishes those from
  companies that are genuinely illiquid. So the filter requires a complete
  pass; an upstream rate limit makes it report unavailable rather than return
  an empty list as though no market existed anywhere.
- **The ratio compares like with like.** The count is stated against the
  matches before the liquidity filter, not against the whole catalog, so with
  a provider or sector also chosen it reads "1 of 432" rather than
  "1 of 1,339".

## 4. Measured on 20 September 2026

Across every verified mint, not a sample. These are live readings and they
drift through the day; the product recomputes them rather than quoting this
table.

| | xStocks | Backpack | Ondo |
| --- | --- | --- | --- |
| Verified mints | 711 | 1,069 | 432 |
| Traded in 24h | 54 | 53 | 29 |
| 24h volume | $96.1M | $40.2M | $8.5K |
| Pooled liquidity | $24.6M | $11.4M | $72.4K |
| Token holders | 573,152 | 226,214 | 23,895 |
| Companies only this issuer represents | 176 | 397 | 84 |

The counts matter more than the totals. Backpack publishes 1,069 Solana mints
and 53 of them have an on-chain market; its tokens mostly trade on Backpack's
own order book, which is not counted here because it is not pooled Solana
liquidity. An issuer with a thousand mints and fifty live markets is a
different product from an issuer with fifty of each, and a total alone hides
exactly that — so every total is reported beside the mints it came from.

## 5. Each issuer's own source

### xStocks — `https://api.xstocks.fi/api/v2/public`

Public, unauthenticated, and the only one of the three that publishes proof of
reserves. Read 20 September 2026:

- **928 assets**, every one with a Solana deployment; **711 match a verified
  Henar mint** by published address. The match is made on the address, never
  on a symbol — two issuers tokenize NVIDIA under symbols one character apart.
- **11 chains**: Solana, Ton, Optimism, Ink, XLayer, Ethereum, BNB Chain,
  Mantle, HyperEVM, Arbitrum, Tron.
- **Listing venues**: NYSE 436, NASDAQ 273, LSE 92, HKEX 79, ARCA 34 and
  others — the catalog is not US-only.
- **734 assets trade 24/5**; the rest follow their listing venue's hours.
  7 were reported halted.
- **Proof of reserves**: 926 records, custodied at Alpaca (655) and GTN (82).
  Of the 736 records with tokens outstanding, **every one reported shares held
  at or above the circulating supply**, the lowest at 1.00001×.
- **50 published price feeds**, all managed by Pyth, which cross-checks
  Henar's own Pyth feed mapping.

Henar repeats the issuer's reserve figures and attributes them. It does not
independently verify custody and does not restate the comparison as a
guarantee.

### Backpack Securities — `https://api.backpack.exchange/api/v1`

Public. Reuses the snapshot the company pages already read, so it adds no
request. A security listed on the exchange is not a token anyone can hold:
the token exists on Solana only once the entitlement is withdrawn, and the
issuer gates withdrawal and deposit per asset. Read 20 September 2026:

- **1,166 securities listed**, **1,156 with a Solana token**, 1,067 verified
  in Henar.
- **56 withdrawal-enabled, 56 deposit-enabled.** That is the number that
  describes this issuer — not how many securities it lists, but how many can
  actually leave it today. It is also the figure that moves most: the issuer
  changes these flags per asset through the day, so the page reads them live
  rather than caching a claim.
- **4 spot markets and 18 perpetual markets** on securities. A perpetual is a
  derivative on the security, not the token, and is labelled as one.

### Ondo Global Markets — `https://api.gm.ondo.finance/v1`

Documented and real, but not public: every route requires an `x-api-key`, and
keys are issued through onboarding rather than self-serve. Probed without one
on 20 September 2026, every route answers `403 Forbidden`. Ondo's public
token list covers Ethereum and BNB Chain only, with no Solana entries.

The adapter is written against the documented contract and reports
`not_configured` until `ONDO_API_KEY` exists. Nothing about Ondo is estimated
meanwhile: its catalog, market and mint facts come from Henar's registry, from
Jupiter and from the mints themselves, all independent of the issuer's API.

## 6. Token Terminal

Token Terminal indexes tokenized assets as first-class assets with issuers,
chains and a reference asset each token tracks — the same shape Henar's
registry has, which makes it a genuine cross-check rather than a second copy.

**Its REST API is on the paid API plan.** The free plan covers the Explorer,
Sheets and the MCP server, none of which issue a REST key; probed on
20 September 2026 with no key, every `v2` route answers
`403 {"message":"invalid token"}`.

So `src/lib/tokenterminal/` is built the way the Pyth Pro layer was built
before a key existed: complete against the published contract, reporting
`NOT_CONFIGURED` with the reason until `TOKENTERMINAL_API_KEY` is set. Adding
a key needs no code change.

| Module | Role |
| --- | --- |
| `config.ts` | Base URL, endpoint paths, metric ids, cache windows, plan note |
| `client.ts` | Bearer REST client; typed errors for 401 / 403 / 404 / 429 / 5xx / malformed |
| — | Paging ends on the rows a page held, not on the rows that survived validation, so one malformed asset cannot truncate the catalog |
| `assets.ts` | Address-keyed matching of Henar mints to Token Terminal assets |
| `coverage.ts` | Entitlement and coverage, measured at runtime |

Endpoints used, exactly as the published spec defines them: `GET /v2/assets`,
`GET /v2/assets/{asset_id}`, `GET /v2/assets/{asset_id}/metrics`,
`POST /v2/assets/{asset_id}/metrics-breakdown`, `GET /v2/reference-assets`.
Metrics requested: `asset_market_cap_circulating`, `asset_holders`,
`asset_transfer_volume`, `asset_price`.

A whole issuer's metrics are one breakdown call grouped by asset, not one call
per token, and the asset ids are deduped first because two verified mints can
be two addresses of one asset. A 403 saying `invalid token` is classified as a
credential failure, not an entitlement refusal — they are different facts and
coverage reports them differently.

Every cache in this layer is keyed to the ambient credential. A caller passing
its own key or its own fetch bypasses the shared cache entirely, because a
surface whose whole job is "what can *this* key read" must never answer with
another credential's entitlement. The same rule applies to the issuer
disclosure caches and to the Jupiter catalog pass.

## 7. Surfaces, API and flags

- **Markets overview** carries the issuer comparison. Each row links to
  `/markets/issuers/<issuer>`.
- **`/markets/issuers/<issuer>`** is one issuer's page: identity and links,
  key stats, its catalog, its on-chain market, its own disclosures, proof of
  reserves where it publishes any, its most traded tokens, and a panel naming
  every source behind the page. It ends with links to the other two issuers,
  so a reader can move between them without a menu.
- There is no issuer index page and no issuer tab. The comparison is the index.
- `GET /api/markets/issuers` — the comparison behind the overview block.
- `GET /api/equities?liquidity=traded|liquid` — the liquidity filter. The
  response carries `liquidityAvailable`, which is `false` when the filter was
  asked for but the market could not be read.
- `HENAR_ISSUER_INTELLIGENCE` gates Markets → Issuers. Read-only, so it
  defaults on.
- `TOKENTERMINAL_API_KEY` and `ONDO_API_KEY` are server-only and never reach
  the browser.

## 8. Validation

- 26 offline tests in `tests/issuers.test.ts` and `tests/tokenterminal.test.ts`.
  Suite: **467 → 493 tests, 492 passing, 1 intentionally skipped** (the live-RPC
  Raydium quote). Lint, typecheck and build clean.
- All three issuer pages, the overview comparison and both liquidity filters
  were exercised against the running product at desktop and 375px widths.
- Every count in section 4 and section 5 was read from the live sources on
  20 September 2026 and is reproduced by the running product.

## 9. Not done

- No issuer's reserve attestation is independently verified. Henar reports what
  the issuer publishes, attributed.
- Backpack's own order book is not counted as liquidity anywhere on this page.
- Token Terminal is unconfigured on this deployment, so its blocks report
  `Not configured` rather than data.
- The catalog-wide pass covers Solana. An issuer's deployments on other chains
  are reported from its own catalog and are not measured by Henar.
- "Traders, 24h" is summed per mint, so a wallet trading two of one issuer's
  tokens counts twice. It is an upper bound on distinct traders and the page
  says so; a distinct-wallet count needs an indexer Henar does not run.
- An unknown issuer slug renders the not-found page but answers `200`. That is
  pre-existing behaviour for every dynamic route in this app — `/markets/pre-ipo/<unknown>`
  does the same — and comes from the CSP middleware wrapping the response. It
  is not specific to these pages and was not changed here.
