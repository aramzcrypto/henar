# Henar Markets

Markets is Henar's company-level abstraction over issuer-specific Solana tokens. A company such as NVIDIA appears once. Its verified xStocks, Backpack Securities, and Ondo representations remain distinct records with their own mint, token program, mechanics, liquidity, and execution terms.

## Data boundaries

- `src/lib/equities/types.ts` defines company, representation, live execution, corporate-action, research, and quote contracts.
- `src/lib/equities/providers/` contains one adapter per provider. The adapters accept only entries attributed to that provider's public source.
- `src/lib/equities/registry.ts` groups the verified mint catalog by underlying ticker. It does not assert legal or technical fungibility.
- `src/lib/equities/onchain.ts` verifies mint ownership, token program, and decimals against Solana mainnet.
- `src/lib/equities/jupiter.ts` normalizes Jupiter reference data and executable route quotes. A missing route or field remains unavailable.
- `src/lib/equities/compatibility.ts` exposes future Portfolio and Packs grouping without adding token balances across issuers.

The imported catalog snapshot was refreshed on 13 September 2026. Its source URLs and content hashes are recorded in `src/data/catalog-report.json`. It contains 2,212 verified issuer-published mints grouped into 1,339 company or ETF tickers, including 1,069 Backpack representations. Leveraged, inverse, invalid, and issuer-metadata-missing entries listed in that report remain excluded. Issuer deposit/withdrawal availability and live execution are evaluated separately from representation existence.

## Execution

`POST /api/quote` compares fresh ExactIn routes across every verified representation of the requested company. Buy amounts are USDC notional; sell amounts are displayed token units. Results include the 15 bps Henar market fee, provider fees, Token-2022 UI multipliers, minimum output, price impact, quote freshness, and a sanitized route plan. The response is indicative and explicitly non-executable. `/trade` still constructs, validates, simulates, and signs a fresh transaction. The Market ticket also supports direct stock-to-stock pairs when an executable route exists.

The Onchain comparison requests executable buy quotes at $1,000, $10,000, and $50,000. Buy and sell prices use approximately the same $1,000 notional, which makes spreads comparable across representations. `BEST EXECUTION` compares net stock received from the same $10,000 gross input after provider and Henar fees. Price-impact values are normalized as percentages and rejected when an upstream value is negative, malformed, or impossible. An issuer token with no valid route is shown as unavailable.

Raydium, Orca, and Meteora pool records are queried by exact verified mint pair and retain their source and pool address. Liquidity and volume are aggregated only from those independently identified pools. Quote and pool timestamps are exposed so the UI can distinguish fresh execution data from unavailable data.

## Research and corporate actions

Research interfaces and the corporate-action schema are active, but no external research/indexing source is connected. Those endpoints return explicit unavailable or empty verified states. Corporate actions must include an issuer, SEC, or provider source before ingestion. Sector filters remain disabled until verified sector classifications are connected.

## Issuers

The Markets overview compares the three issuers on the axis the company pages
cannot: 24h volume, pooled liquidity, live markets and holders, each reported
beside the mints it was measured over. Every row links to that issuer's own
page at `/markets/issuers/<issuer>`, which carries its catalog, its onchain
market, its own disclosures and — where it publishes any — its proof of
reserves. Issuers are not a tab: a reader arrives at one from a figure, not
from a menu. Each block names its source and its own availability. See
[issuers](ISSUERS.md).

## API

- `GET /api/equities`
- `GET /api/equities/overview`
- `GET /api/markets/issuers`
- `GET /api/equities/NVDA`
- `GET /api/equities/NVDA/representations`
- `GET /api/equities/NVDA/onchain`
- `GET /api/equities/NVDA/corporate-actions`
- `POST /api/quote`

Static issuer metadata is cached longer than Jupiter market data. Quote responses are private, not cached, and bounded per client instance. Production should also retain a distributed Vercel Firewall limit. No admin, solver, RPC, or Jupiter credentials are returned to the browser.

Ranked market views rank the whole verified universe. One cached pass reads every mint in the catalog — Jupiter answers for a hundred at a time, so 2,212 mints is about twenty-three calls — and most traded and most liquid rank against all of it. The same pass powers the liquidity filter and the issuer comparison, so none of the three costs an extra request. Execution never reads it: `/trade` quotes fresh.

The All markets liquidity filter states its rule rather than implying it. "Traded in 24h" means at least one verified mint traded; "Liquid onchain" additionally requires $10,000 or more of pooled liquidity behind it. Measured on 20 September 2026 that is 101 and 75 companies respectively, of 1,339. The filter is scoped to a selected provider, so narrowing to Ondo asks about Ondo's own token rather than the company's best token across all three issuers. A partial market read may reorder but never exclude: if the pass is short or fails, the filter reports itself unavailable instead of returning an empty list.

The Recently tokenized view remains disabled until verified provider tokenization timestamps are available.

Breadth on the overview is the share of companies that rose over 24 hours, counted across those with a live onchain price rather than across the catalog. It carries an explanation on the tile itself, because the denominator is not the obvious one and the word is the only piece of jargon on the page. The control is `InfoTip`, lifted out of the Earn products page where it already served nine of these: it opens on hover and on focus, closes on Escape, and is announced through `aria-describedby` rather than a `title` attribute, which never reaches a keyboard or a screen reader.

The default Markets overview intersects Jupiter's public 24-hour top-traded token feed with exact verified registry mints. It does not infer companies from token symbols or names. News remains unavailable until a verified feed is connected.
