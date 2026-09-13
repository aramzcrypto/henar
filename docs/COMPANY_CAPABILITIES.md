# Company capabilities, routes and Earn

Henar's Markets layout and company tabs are preserved. The Onchain tab now adds compact acquisition/redemption and Earn tables, exact-mint capability metadata, and a distinction between the US regular session and recent Solana quotes.

## Verification and execution boundaries

- Representation capabilities default to false. The live Onchain response enriches them with observed routes and verified Earn reserves. False means not currently verified/available, not a definitive statement about an issuer's product.
- Backpack requires an exact Solana contract-address match in `/api/v1/assets`, intersected with `/api/v1/securities`. A brokerage listing alone cannot expose a token route.
- Primary Mint is withdrawal of an eligible security entitlement into its Solana token. Primary Redeem is deposit of that token into the account's corresponding entitlement, not an automatic USDC redemption. Live `withdrawEnabled` and `depositEnabled` independently gate the routes.
- Account linkage, KYC/jurisdiction permissions, account limits, funding, 2FA and authenticated execution are not implemented. Supported routes remain connection-gated, with no price or simulated success. Disabled routes remain visible as unavailable. Discovery makes public GET requests only.
- Stock RFQs use the documented `<SECURITY>_USDC_RFQ` form and are not listed by `/markets`. They require a securities quantity; quoteQuantity is unsupported. Sessions and deferred entitlement settlement are explained in the details. No authenticated RFQ is submitted or accepted.
- Other providers' primary routes and Earn support remain unavailable until exact asset-level evidence is integrated. Existing issuer terms remain provider-specific.

## Quote comparison

`EquityRoute` normalizes DEX, RFQ, PRIMARY_MINT and PRIMARY_REDEEM. `bestNetRoute` ranks fresh, available quotes with equal input amounts and compatible input/output units by net delivered output. Tests include a primary-mint quote winning over a DEX quote, plus rejection of unquoted, gated, expired and noncomparable routes. Distinct issuer sell balances are not treated as substitutable inputs.

The current all-in token quotes come from the existing DEX aggregation. Primary routes have no complete funding-plus-withdrawal quote, so they cannot win. The UI says “Best quoted $10k route” and explicitly excludes unknown network fees. Provider and Henar fees are included. The old fallback from a missing $10k quote to a $1k winner was removed. Expired best-route quotes disappear in the client.

`POST /api/quote` preserves the existing DEX response fields and adds normalized routes, bestRoute and comparisonBasis. When only connection-gated provider routes exist, the response has a null selectedRepresentation and no executable quote.

`GET /api/equities/:ticker/onchain` adds routes, bestRoute, capabilities, Earn source health and traditionalMarket status. `GET /api/equities/:ticker/earn` provides independent Earn discovery. Successful public source snapshots are briefly cached and shared across company reads; failures never become fake empty successful opportunities.

## Earn

The Kamino adapter reads the documented xStocks market's live reserve metrics. Exact liquidity-token mints map to the company registry. Fractional supply APY is converted to percent; absent APY remains null, while a genuine zero remains zero. Rates exclude separately calculated incentives. TVL and utilization are included when available. Existing reserves are labeled “Check availability”: metrics do not prove deposit capacity or account eligibility. Links open Kamino discovery; Henar does not manage yield positions.

Veda is a separate unavailable adapter because no verified Solana stock-vault mapping and public rate feed was established. No APY, vault or LP opportunity is invented. Discovery scope is the official Kamino xStocks market, not an exhaustive search across every Solana protocol.

## Market hours

The company page labels the US regular session, not all extended sessions. New York local time handles DST; Backpack's public market-holidays feed supplies closures and shortened sessions. In-session status becomes unknown if the calendar cannot be loaded. The Solana indicator depends on recent representation-level quotes and does not assert 24/7 trading.

The optional Markets overview after-hours section is deferred: a reliable reference-close series with clear timestamps is not present. No Markets redesign or unrelated Trade/Earn/Packs/Portfolio refactor was made.

## Official sources reviewed September 13, 2026

- [Backpack API: Stock Trading, assets, securities, deposits, withdrawals and calendars](https://docs.backpack.exchange/)
- [Backpack securities conversion explanation](https://learn.backpack.exchange/articles/how-to-hold-spcx)
- [Kamino reserve metrics schema](https://kamino.com/docs/build/kamino-lend-markets/get-metrics-for-market-reserves)
- [Kamino xStocks market address](https://kamino.com/docs/build/developers/multiply/operations/withdraw-xstocks)
- [Kamino APY unit conversion](https://kamino.com/docs/build/recipes/borrow/get-market-reserve-apys)

## Validation

- All 109 repository runtime tests passed; 13 focused equity/capability tests passed after the final logic updates.
- ESLint passed for the changed equity, API, component and test files.
- Global type checking reports an unrelated existing worktree error in `tests/pack-swap.test.ts:51` (`setupInstructions` inferred as `never[]`). This task does not change that file.
- Live Backpack metadata and Kamino reserve discovery were exercised. At the time checked, NVIDIA conversion flags were disabled and the exact NVDAx reserve was present.
- Browser verification covered the NVIDIA page on desktop and at 390px width. Mobile document width equals viewport width; wide financial tables scroll inside their containers. Existing wallet-provider warnings were observed in the isolated development preview.
