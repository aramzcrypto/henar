# Henar execution aggregation

Henar separates the company registry, quote providers, liquidity venues and
transaction executors. A provider may quote a route containing several venues;
the same pool is not treated as a second independent quote merely because it
also appears in another provider's route.

## Quote providers

- Jupiter V2 meta routing
- Raydium Transaction API
- OpenOcean V4 through QuickNode, enabled only when `OPENOCEAN_API_URL` is set
- Titan Argos, enabled only when `TITAN_WS_URL` and `TITAN_API_KEY` are present

## Venue probes and pool data

Henar can compare venue-restricted Jupiter quotes for Orca, Meteora, Phoenix,
OpenBook and Lifinity. It independently reads Raydium, Orca and Meteora pool
indexes for pool identity, TVL, volume and fee data. Every record retains its
source and exact pool address. Missing or blocked sources remain unavailable.

## Execution policy

Quote ranking uses exact integer output after provider fees and then the exact
minimum output after provider fees. The OpenOcean free plan's mandatory 15 basis
point fee is deducted before its quote can compete with other candidates. The Market
ticket refreshes its comparison every six seconds while it is visible and idle,
then freezes the reviewed transaction before signing. Candidate amounts shown
to users are net of Henar's shared 15 basis point Market fee. The same fee is
collected atomically with every enabled Market execution route.

Market routes may use any two distinct verified or wallet-held Solana mints,
including one issuer's stock token for another issuer's stock token. Henar ranks
the direct stock-to-stock route by net output after provider and Henar fees; it
does not treat the two representations as legally or technically fungible.

A quote is not automatically executable. The current wallet and program execution path
accepts only Jupiter Route V2 instructions because those instructions have a
strict parser, custody checks and full transaction simulation. Raydium and Titan
quotes can win the comparison today, but their transaction bytes remain locked
until equivalent instruction policies are implemented and reviewed.

This keeps independent price discovery useful without asking a wallet to sign
opaque instructions from a newly added source. OpenOcean also remains quote-only
until its swap instructions pass those checks.

When a direct quote wins, the final review obtains a fresh executable route and
may differ from the indicative comparison. A provider becomes directly
executable only after its instructions pass the same custody, amount, recipient,
fee and simulation checks as the existing Jupiter Route V2 path.

## Internal endpoints

- `POST /api/execution/quote` compares raw exact-input routes.
- `GET /api/equities/{ticker}/liquidity` returns representation-level pools.
- `POST /api/quote` applies the same routing layer at the canonical company level.
