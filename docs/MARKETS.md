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

## API

- `GET /api/equities`
- `GET /api/equities/overview`
- `GET /api/equities/NVDA`
- `GET /api/equities/NVDA/representations`
- `GET /api/equities/NVDA/onchain`
- `GET /api/equities/NVDA/corporate-actions`
- `POST /api/quote`

Static issuer metadata is cached longer than Jupiter market data. Quote responses are private, not cached, and bounded per client instance. Production should also retain a distributed Vercel Firewall limit. No admin, solver, RPC, or Jupiter credentials are returned to the browser.

Ranked market views currently rank the fetched verified result window and disclose that coverage in the UI. Complete-universe rankings require a persistent market-data snapshot or indexer.

The Recently tokenized view remains disabled until verified provider tokenization timestamps are available.

The default Markets overview intersects Jupiter's public 24-hour top-traded token feed with exact verified registry mints. It does not infer companies from token symbols or names. News remains unavailable until a verified feed is connected.
