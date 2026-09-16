# Henar Equity Router — Handoff (16 September 2026)

For the next Claude Code session on any device. Read this, then
`docs/router/ARCHITECTURE.md`, `LIVE_VALIDATION.md`, `MISSING_LIQUIDITY.md`,
`METEORA-DBC.md`. Owner preference: **no Claude co-author trailer on commits.**

## Goal

Henar is a meta-aggregator for tokenized equities on Solana: quote our own
venues from on-chain state, benchmark Jupiter/OpenOcean, and route to an
aggregator only when it beats our engine. User-facing scope stays
`USDC ↔ verified representation`; internally a route may pass through one
qualified intermediate (SOL, USDT, …). Fee is 10 bps (`MARKET_FEE_BPS`).

## State of the code (main)

- 351 tests (`npm test`), typecheck and lint clean.
- **Venues quoting from chain:** Raydium CLMM, Raydium CPMM (new; 66 registry
  pools, none above the TVL floor yet), Meteora DLMM/DBC/DAMM v2, Orca
  Whirlpools. Native builders for Raydium CLMM/CPMM, Orca, DBC, DAMM v2.
  Benchmarks: Jupiter (executable through the reviewed /api/market path),
  OpenOcean. OKX evaluated and rejected (`OKX_EVALUATION.md`).
- **RFQ:** `packages/venue-rfq` is a firm-quote client over a documented JSON
  protocol, quote-only, configured by `HENAR_RFQ_URL`/`HENAR_RFQ_API_KEY`.
  No open-API maker exists today (Express Relay retired, Titan paid, JupiterZ
  reachable only inside Jupiter's order flow, already ranked as `jupiter`).
- **Engine:** every enabled pool quoted, split routing across pools, and the
  new **two-leg path** (`packages/router-core/src/path.ts`): buy
  USDC → intermediate → equity over ROUTING_LEG pools, the USDC-side hop over
  INTERMEDIATE_ROUTE pools (SOL, USDT, JUP … from `router:discover:intermediates`).
  The second hop is sized on the first hop's *floor*; whatever the first hop
  returns above it stays in the wallet as `residual`. Reported as
  `henarPath` and selected when it beats the split and every direct quote.
  `HENAR_PATH_ROUTING=0` turns it off.
- **Guard:** path legs are checked with their hop role (`pathLeg` in the
  guard context); the USDC hop uses a fixed 10 bps slippage
  (`intermediateHopSlippageBps`); the API re-checks that the guard's floor is
  exactly what the path was sized on before selecting it.
- **Planner/builder:** `ExecutionPlan.kind` is `parallel` or `path`; path
  plans add an `intermediate` ATA and chain floors. The client validator
  (`src/lib/router-transaction.ts`) checks the hop pairs.
- **Simulation gate is live in the build path:** `RouterApi.quoteAndBuild`
  simulates every built transaction as the owner and refuses on error, floor
  shortfall or an unverified output (`gateSimulation`, `RpcSimulator` wired in
  `src/app/api/router/build/route.ts`).
- **Protected submit:** `POST /api/router/submit` runs `submitWithPolicy`
  (Jito bundle when `HENAR_PRIVATE_SUBMIT=1` + `JITO_BLOCK_ENGINE_URL`, RPC
  fallback). Returns 503 when unconfigured; the ticket then broadcasts via the
  wallet RPC as before.
- **DBC Studio (DBC-18…23) complete:** `packages/dbc-studio` (monitor,
  config engine, liquidity-targeted graduation model, fee profile, deploy
  guard), APIs `GET /api/dbc/markets`, `GET|POST /api/dbc/studio/model`,
  `POST /api/dbc/studio/prepare` (admin wallet session), UI at `/studio`
  (Configure → Model → Review → Deploy → Monitor). Config and mint keypairs
  are generated in the browser; the wallet signs; mainnet needs
  `HENAR_DBC_MAINNET_DEPLOY=1` + review hash + typed acknowledgement.
  Localnet deployment only works with the app running locally next to the
  validator (the server reads the quote mint through the cluster RPC).

## Vercel

Set: HENAR_ROUTER_QUOTES, HENAR_ROUTER_UI, NEXT_PUBLIC_HENAR_ROUTER_UI,
HENAR_METEORA_DBC_QUOTES, HENAR_METEORA_DAMM_V2_QUOTES,
HENAR_ROUTER_EXECUTION (owner), HENAR_DBC_STUDIO, NEXT_PUBLIC_HENAR_DBC_STUDIO.
Not set on purpose: HENAR_DBC_MAINNET_DEPLOY, HENAR_PRIVATE_SUBMIT,
JITO_BLOCK_ENGINE_URL, HENAR_RFQ_URL.

## Next

1. **Owner:** first live router trade ($10 BA or AMC); keep the signature;
   run `npm run router:trace -- <sig>` and record in `LIVE_VALIDATION.md`.
2. Confirm on production that INTERMEDIATE_ROUTE pools verified at build
   (`/api/router/pools`) and that a path shows up for an equity whose SOL pool
   is deeper than its USDC pool (`henarPath` in `/api/router/quote`).
3. First path execution ($10) once quotes show one; check the residual lands
   in the wallet's wSOL account as expected.
4. DBC Studio devnet dry run with a devnet-funded admin wallet; then decide
   on mainnet (flag stays off until then).
5. Decide on a Jito endpoint for protected submit; exercise once.
6. If an RFQ maker with an open API appears, set `HENAR_RFQ_URL` and confirm
   its wire shape matches `packages/venue-rfq` (or adapt the parser).
7. MM-style DEXs (ZeroFi, Archer …) stay deprioritised per `MISSING_LIQUIDITY.md`.
