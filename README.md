# Kani Markets · Stockroom

Solana stock trading, USDC yield, and sealed Stock Packs. The application, Anchor program, and settlement worker are implemented for integration testing. **Stockroom is not deployed or enabled on mainnet. No funded mainnet transaction has been validated.**

Public Solana hackathon submission. The app currently retains the Stockroom interface branding.

- [Live application](https://kanimarkets.vercel.app)
- [Source repository](https://github.com/aramzcrypto/kani-markets)

The website is publicly hosted; the custom Solana program remains undeployed pending funding and Pyth access.

## Run

Node 22:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The interface works without credentials and shows unavailable services instead of invented APY, balances, orders or pack receipts. Server-only credentials go in `.env.local`; command-line scripts also load `.env.local` automatically. Never put private keys in the frontend, Vercel, git, or chat.

## Implementation

- Market trades use Jupiter Swap V2 `/build`, wallet signatures, simulation, exact fee review and confirmation polling. Payment tokens may be any routable Solana token; receiving stocks come from the issuer registry.
- Earn deposits USDC into a pinned Kamino vault under each position's PDA authority. It tracks principal, vault shares, yield, protocol fees and allocated yield separately with integer accounting. Yield destinations are Packs or Stocks. APY, TVL and charts come from Kamino's actual metrics.
- Limit and DCA orders deposit USDC, earn while waiting, and permit owner cancellation. Settlement validates fresh, fully verified Pyth prices and actual stock delivery before releasing payment.
- Stock Packs cost 10 USDC. Purchased packs reserve a 2% fee; earned packs use 10 USDC of net yield with no additional opening fee. The configured yield share is 10%. Sealed batches support purchases, gifts with a message, opening and refunds. ORAO randomness determines the selected stock onchain. No NFTs are minted.
- The worker can deliver inventory or combine a Jupiter swap and settlement atomically. It journals signatures before submission, reconciles uncertain transactions, retries with backoff, and publishes a health file.
- Portfolio reads actual token accounts, protocol positions, sealed batches and opening receipts. Scaled Token-2022 holdings use RPC UI quantities; settlement receipts record the multiplier at acquisition.

The broad Market catalog has 1,186 issuer listings. The candidate V1 contract manifest has **39 Backpack stocks** with matched Pyth feeds; DNUT, HTZ and SPHR are excluded because no unambiguous feed was found. Listing/manifest membership does not guarantee liquidity, transferable eligibility or an executable quote.

## Validation and release

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run contracts:build
npm run mainnet:plan
npm run mainnet:cost
npm run protocol:preflight
```

`contracts:build` builds the SBF executable and generated IDL, checks SBF stack diagnostics, and runs arithmetic and program-runtime tests. Additional ignored tests run against snapshots of deployed Kamino/ORAO/Pyth programs. Test wallets and snapshots are never broadcast.

See [mainnet setup](docs/MAINNET.md), [validation evidence](docs/VALIDATION.md), and [accounting and execution](docs/EARN-PACKS.md). Missing credentials are only one part of release: deployed-binary verification, authenticated oracle verification, liquidity checks and funded end-to-end transactions must pass before public activation.

## Refresh catalogs

`python3 scripts/import-stock-catalog.py` refreshes issuer-published listings and logos. `npm run manifest:prepare` prepares a candidate Backpack/Pyth mapping; review it before uploading a new immutable manifest. Existing positions and packs retain their original manifest. Oracle ratios describe underlying exposure; they are not guessed from DEX ticker matches.
