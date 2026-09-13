# Henar

Henar is a unified market for tokenized equities on Solana. It groups verified representations of the same company into one market, compares execution and issuer details, and connects trading with yield-powered stock accumulation.

- [Live application](https://henarapp.vercel.app)
- [Markets](https://henarapp.vercel.app/markets)

## Products

- **Markets** — Browse 1,339 companies and ETFs across 2,212 verified xStocks, Backpack Securities, and Ondo representations. Company pages show issuer-specific tickers, live onchain activity, research, and redemption terms.
- **Trade** — Compare supported routes for market swaps, create yield-bearing limit orders, and schedule DCA purchases.
- **Earn** — Deposit USDC into a pinned Kamino strategy and direct generated yield toward stocks or Packs.
- **Packs** — Buy or earn sealed stock packs with onchain settlement and ORAO randomness.
- **Stockfolio** — Read wallet holdings, protocol positions, sealed packs, and confirmed opening receipts.

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

The repository also contains release checks for protocol configuration, routes, transaction size, treasury accounts, and deployment planning. See [validation evidence](docs/VALIDATION.md), [mainnet setup](docs/MAINNET.md), and [security review](docs/SECURITY_REVIEW_RETEST_2026-09-13.md).

The current review and test evidence supports a hackathon preview. A funded public launch still requires deployed-binary verification, capped rollout testing, operational monitoring, and an independent smart-contract audit.
