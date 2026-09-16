# Henar Router — Live Validation

Status as of 16 September 2026. Each gate says what has actually run against
mainnet and where the evidence is. "Pending" means not yet run, not "assumed".

Preconditions on any device: `git pull && npm ci && npm run typecheck && npm run lint && npm test`.
Every script reads `.env.local` (`SOLANA_RPC_URL`, `JUPITER_API_KEY`,
`STOCKROOM_TREASURY_OWNER`). Production has the same values in Vercel.

## Gates

| Gate | Task | Status | Evidence |
|---|---|---|---|
| Live Raydium CLMM quotes | 6/7 | **done** | production `/api/router/quote` (BA, AMC, NVDAx) and `BENCHMARK_MATRIX_V2.md` |
| Live Orca Whirlpool quotes | 7 | **done** | production quotes; `check-orca-quotes.ts` |
| Live Meteora DLMM / DBC / DAMM v2 quotes | 5, DBC-7/8 | pending (no enabled pool) | registry has no enabled DLMM/DBC/DAMM v2 pool for a listed equity |
| Pool on-chain verification pass | 9 | **done, every deploy** | `prebuild` → `apps/router/src/verify-pools-cli.ts`; 587 pools verified incl. pair check (`Verify that a pool trades the pair the registry claims`) |
| Mint verification pass | 9 | **done** | `src/data/router/mints.json`, `router:verify:mints` |
| Native-vs-SDK comparison | 11 | **done** | `router:validate` (`scripts/router/validate-native.ts`) |
| Jupiter benchmark | 8 | **done** | `router:benchmark`, `router:forensics`; `MISSING_LIQUIDITY.md` (Jupiter routes 100% via JupiterZ) |
| Benchmark matrix | 25 | **done** | `BENCHMARK_MATRIX_V2.md` (196 observations, sells included) |
| Build + simulate native routes | 14/16 | **done as harness; live in production build path** | `router:validate:build-sim`; `RouterApi.quoteAndBuild` now simulates every built transaction (`RpcSimulator`) and refuses on error or a floor shortfall (`gateSimulation`) |
| Blockhash provider (RPC) | 14 | **done** | build route |
| Protected submit transports | 17 | **wired, not exercised** | `/api/router/submit` (Jito bundle when `HENAR_PRIVATE_SUBMIT=1` + `JITO_BLOCK_ENGINE_URL`; RPC fallback under one policy). Off by default → the ticket broadcasts through the wallet's RPC. No bundle has been sent. |
| Reconciliation against a real signature | 18 | pending | needs the first live router trade |
| WebSocket stream / worker readiness | 19/20/22 | pending | `router:serve` only; production is serverless and quotes stateless |
| Two-leg path (USDC ↔ SOL/USDT ↔ equity) | new | **quotes live after next deploy; execution untested** | `packages/router-core/src/path.ts`; INTERMEDIATE_ROUTE pools in the registry are DISCOVERED until the deploy-time verification pass marks them |
| Raydium CPMM adapter | new | code + offline tests only | 66 registry CPMM pools, all below the TVL floor → none enabled |
| RFQ venue | new | not configured | `packages/venue-rfq`: no open-API maker exists (Express Relay retired, Titan paid, JupiterZ inside Jupiter); set `HENAR_RFQ_URL` when one does |
| First live router trade | — | **pending — owner** | `HENAR_ROUTER_EXECUTION=1` is set in production; trade $10 BA or AMC, keep the signature |
| DBC Studio devnet deployment | DBC-22 | pending — owner | `/studio` with `HENAR_DBC_STUDIO=1`; devnet needs a devnet-funded admin wallet |
| DBC Studio mainnet deployment | DBC-23 | **blocked by design** | `HENAR_DBC_MAINNET_DEPLOY` is unset; the server refuses |

## How to run the pending ones

```bash
# first live trade: use the UI; then reconcile
npm run router:trace -- <signature>
```

```bash
# protected submit (only once a Jito endpoint is decided)
HENAR_PRIVATE_SUBMIT=1 JITO_BLOCK_ENGINE_URL=https://<region>.mainnet.block-engine.jito.wtf npm run dev
```

```bash
# path routing check against production once deployed
curl -s -X POST https://henarapp.vercel.app/api/router/quote -H 'content-type: application/json' \
  -d '{"mint":"<equity mint>","side":"buy","amount":"1000000000"}' | jq '.henarPath, .henarPathReason'
```
