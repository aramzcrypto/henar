# Henar

**Henar is the market and intelligence layer for stocks on Solana.**

> One company. Every representation. One market.

A tokenized stock exists several times over. NVIDIA is `NVDAx` on xStocks, `NVDA` on Backpack Securities, and `NVDAon` on Ondo — different mints, different token programs, different issuer mechanics, different liquidity. Every venue today asks the user to pick a token. Henar asks them to pick a company, then does the comparison work underneath.

- [Live application](https://henarapp.vercel.app)
- [Markets](https://henarapp.vercel.app/markets)

## What we are building

Henar is not a DEX for tokenized stocks. It is the layer a user goes through before and after the trade:

| | |
| --- | --- |
| **Discover** | 1,339 companies and ETFs, 2,212 verified issuer mints, grouped by underlying company |
| **Research** | Financials, earnings, dividends, filings and news from SEC EDGAR; an earnings and macro calendar |
| **Compare** | xStocks, Backpack and Ondo side by side — price, spread, liquidity, route, redemption terms |
| **Trade** | Market, limit and DCA execution routed across Solana venues |
| **Pre-IPO** | Private-market exposure from PreStocks and Tessera, priced against provider marks and Henar's own routes |
| **Earn** | Yield strategies that turn idle USDC into stock exposure |
| **Manage** | Holdings, protocol positions and settlement receipts in one place |

The unit of the product is the company, not the mint. Issuer differences are preserved and surfaced where they matter — Henar normalizes the experience without claiming that one issuer's product is legally or technically the same as another's.

## Products

- **Markets** — Company-first discovery across every verified representation, public and private. Overview, a full directory with sector classification, and a calendar of earnings and macro events. Company pages carry financials, earnings, news, dividends, filings, and an Onchain tab comparing every issuer representation.
- **Trade** — Compare supported routes for market swaps, create yield-bearing limit orders, and schedule DCA purchases.
- **Earn** — A featured USDC strategy that turns yield into stock exposure, plus a directory of verified stock pools across Solana lending markets and vaults. Each pool has its own page and ticket; only the featured strategy is wired to the protocol today, and the rest are explicitly marked Coming soon.
- **Packs** — Buy or earn sealed stock packs with onchain settlement and ORAO randomness.
- **Stockfolio** — Read wallet holdings, protocol positions, sealed packs, and confirmed opening receipts.

## Data policy

Henar shows verified data or it shows nothing. Sector classification comes from each company's SEC-filed SIC code. Earnings come from filed XBRL facts. Prices and routes come from live quotes against exact verified mints. Where a source is not connected, the interface says so rather than estimating — "Unavailable", "Coming soon" and "External opportunity" are real states in this product, not placeholders.

## Submission status

The website is a public development preview. Market discovery and data integrations are live where a verified source is available. The custom Anchor program and settlement worker are implemented for integration testing but are not enabled for public mainnet deposits. Missing quotes, balances, APY, or issuer capabilities are shown as unavailable rather than estimated.

The candidate V1 contract manifest contains 39 Backpack stocks with matched execution requirements. Catalog membership does not guarantee liquidity, issuer eligibility, redemption access, or an executable route.

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
- Jupiter and independent route adapters for execution discovery
- Kamino vault integration for USDC yield
- ORAO randomness for Pack selection
- Exact integer accounting for token amounts and fees
- Wallet-bound authorization, transaction simulation, route validation, and admission limits

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

The repository also contains release checks for protocol configuration, routes, transaction size, treasury accounts, and deployment planning. See [validation evidence](docs/VALIDATION.md), [mainnet setup](docs/MAINNET.md), and [security review](docs/SECURITY_REVIEW_RETEST_2026-09-13.md).

The current review and test evidence supports a hackathon preview. A funded public launch still requires deployed-binary verification, capped rollout testing, operational monitoring, and an independent smart-contract audit.
