# Henar Equity Router — Handoff (15 September 2026)

For the next Claude Code session on another device. Read this, then
`docs/router/ARCHITECTURE.md`, `METEORA-DBC.md`, `LIVE_VALIDATION.md`.
Everything below is committed on `main` (last commit `59a0100`) and deployed
to henarapp.vercel.app. Owner preference: no Claude co-author trailer on commits.

## Goal

Henar is a meta-aggregator for tokenized equities on Solana: quote our own
venues from on-chain state, benchmark Jupiter/OpenOcean, and route to an
aggregator only when it beats our engine. Scope stays `USDC ↔ verified
representation`. Reference target: Backpack/Titan quoted 46.945 NVDAx for
$10k USDC (zero fee); Jupiter 46.878; Henar's own venues win at small/mid
size, lose at $10k where JupiterZ/OKX RFQ liquidity dominates.

## What exists (all in `packages/*`, `apps/router`, tests in `tests/router`)

- Router Tasks 1–25 implemented; 270 tests (`npm test`), typecheck + lint clean.
- Venues: Raydium CLMM, Meteora DLMM, Meteora DBC, Meteora DAMM v2,
  **Orca Whirlpools** (all quote from chain state via official SDKs; Raydium,
  Orca, DBC, DAMM v2 can build native swap instructions). Benchmarks:
  Jupiter, OpenOcean (`AGGREGATOR_VENUES`). Titan skipped (paid API).
- Engine (`packages/router-core/src/engine.ts`): quotes every enabled pool,
  Henar 15 bps fee (input on buys / output on sells), split routing across
  pools via marginal allocator (on by default; `HENAR_SPLIT_ROUTING=0` off).
- Execution Guard (`packages/execution-guard`): slippage 30 bps + 0.5×impact,
  cap 100 bps; impact cap 150 bps; requires `ONCHAIN_VERIFIED` pool; DBC
  lifecycle/graduation checks; aggregator venues skip registry checks.
- Registry `src/data/router/pools.json` is rebuilt **at every Vercel
  build** (`prebuild`): `apps/router/src/discover-from-jupiter.ts` admits the
  pools Jupiter's route plan uses (Raydium CLMM, DLMM, DAMM v2, Whirlpool),
  reads owner + mints on chain, sizes TVL as 2× USDC vault; then
  `verify-pools-cli.ts` sets ONCHAIN_VERIFIED / VERIFICATION_FAILED. The
  committed file stays DISCOVERED; the deployed artifact is verified.
  `scripts/**` is `.vercelignore`d — build-time code must live in `apps/`.
- Token-2022 policy (`token-extensions.ts`): PermanentDelegate and unpaused
  PausableConfig allowed (xStocks/Backpack carry both); transfer fee > 0,
  transfer hook, non-transferable, paused → refused.
- API: `POST /api/router/quote` (comparison), `POST /api/router/build`
  (session-verified, stateless quote→guard→plan→build), `GET
  /api/router/pools?mint=` (registry view), admin verify endpoint (unused).
  Standalone worker/API in `apps/router` (`npm run router:serve`).
- UI: `src/components/router-comparison.tsx` panel on `/trade` (market mode)
  shows route, expected/min output, "best seen", and a "Trade via Henar
  Router" button when the guard mode is `execute`: validates tx client-side
  (`src/lib/router-transaction.ts`), simulates, wallet signs, sends, polls.
- Vercel env set: HENAR_ROUTER_QUOTES, HENAR_ROUTER_UI,
  NEXT_PUBLIC_HENAR_ROUTER_UI, HENAR_METEORA_DBC_QUOTES,
  HENAR_METEORA_DAMM_V2_QUOTES (all =1). **Not set: HENAR_ROUTER_EXECUTION**
  — the owner must add it (=1) and redeploy; nothing executes via the router
  until then. Claude cannot enter secrets into Vercel.
- `src/lib/protocol/prepare.ts`: three `as never` casts added (Anchor enum
  typing under `@types/bn.js`); `@noble/hashes` pinned 1.8.0 for Orca SDK.

## Live evidence so far

- NVDAx $10: Raydium +2.7 bps vs Jupiter; $1k/$10k Jupiter wins (JupiterZ RFQ).
- AMC $1k: Raydium +7 bps; $10k Jupiter (OKX) wins, single pool 7.6% impact.
- BA $100/$1k: Orca +8–10 bps vs Jupiter and OpenOcean.
- Meteora DLMM pool for AMC quoted live. No DBC/DAMM v2 pools found yet.

## Next (owner's priorities: coverage, split, lower impact, lower fees)

1. Owner adds `HENAR_ROUTER_EXECUTION=1`; test a $10 router trade on BA/AMC.
2. Multi-hop via SOL (USDC→SOL→stock) — needs explicit owner OK (widens
   internal routing scope; user pair unchanged). Jupiter's AMC route is 2-hop.
3. Raydium CPMM adapter (6 registry pools, `CPMMoo8…`).
4. Assess MM-style DEXs Jupiter uses for Backpack stocks: ZeroFi, Archer,
   TesseraV, BisonFi, GoonFi, Kipseli (program interfaces unknown).
5. RFQ (`RFQVenueAdapter` interface exists): open-API sources only.
6. Fee 0.15% → 0.10%: `MARKET_FEE_BPS` in `src/lib/trade-fee.ts` (+ the
   `plan.henarFee.bps !== 15` check in `src/lib/router-transaction.ts`).
7. Live validation items still pending: `npm run router:validate`,
   `router:benchmark:matrix`, RpcSimulator, protected submit transports,
   WebSocket stream; see LIVE_VALIDATION.md.
8. DBC Studio (DBC-18…23) not started.

## Useful commands

```bash
npm test && npm run typecheck && npm run lint
npm run router:discover:jupiter && npm run router:verify:pools   # needs .env.local
npm run router:benchmark -- 100
curl -s -X POST https://henarapp.vercel.app/api/router/quote -H 'content-type: application/json' \
  -d '{"mint":"<mint>","side":"buy","amount":"1000000000"}'
```
