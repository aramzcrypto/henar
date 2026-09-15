# Henar Router — Live Validation Checklist

Status: **every gate below is LIVE_VALIDATION_PENDING.** Nothing on this
list has run against mainnet. Tasks 1–25 exist as code with deterministic
offline tests only (258 tests, fixtures clearly labelled). Execution flags
are off and must stay off until steps 1–11 pass.

Run on the laptop that holds `.env.local` (`SOLANA_RPC_URL`,
`JUPITER_API_KEY`, `STOCKROOM_TREASURY_OWNER`). Every script reads
`.env.local` itself. Record outcomes in this file under "Results".

## 0. Preconditions

```bash
git pull && npm ci && npm run typecheck && npm run lint
```
(`src/lib/protocol/prepare.ts` has three pre-existing type errors unrelated to the router.)

## 1. Unit tests — the live Raydium quote un-skips itself

```bash
npm test
```
Expect `# skipped 0` and `# fail 0`. The test "raydium: live CLMM quote via SDK" is the first proof that `getPoolInfoFromRpc` + `computeAmountOutFormat` produce a quote on a real pool (`49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6`).

## 2. Pool discovery + on-chain verification

```bash
npm run router:discover:raydium
npm run router:discover:meteora
```
Then the on-chain verification pass (**not yet written** — see "Open items"): for every enabled pool re-read both mint accounts and the pool owner, set `verification: ONCHAIN_VERIFIED` + `onchainVerifiedAt`, or `VERIFICATION_FAILED` + detail. Until it exists, the Execution Guard refuses every direct venue (`pool.onchainVerified`), which is the intended fail-closed state.

## 3. Meteora DBC / DAMM v2 discovery

```bash
HENAR_METEORA_DBC_QUOTES=1 HENAR_METEORA_DAMM_V2_QUOTES=1 npm run router:discover:dbc
```
Writes `src/data/router/meteora-dbc-discovery.json` and `meteora-damm-v2-discovery.json`. Establishes whether any stock-paired or USDC-paired DBC market exists today.

## 4. Registry rebuild

```bash
npm run router:pools:build
npm test
```
Check counts printed (pools, enabled, per venue) and that every record still validates.

## 5. DBC lifecycle refresh

```bash
npm run router:dbc:refresh
```
Confirms `classifyDbcLifecycle` and `resolveDammV2Successor` against real program state; graduated pools must show `successorStatus: CONFIRMED` with a DAMM v2 address owned by `cpamd…`.

## 6. Live Raydium quotes

```bash
HENAR_ROUTER_QUOTES=1 BENCH_LIMIT=5 npm run router:benchmark -- 100
```
Every Raydium row must be a quote, not `SDK_ERROR`; latency p50/p95 recorded in `logs/router-benchmark.jsonl`.

## 7. Live Meteora quotes (DLMM, DBC, DAMM v2)

Same command with `HENAR_METEORA_DBC_QUOTES=1 HENAR_METEORA_DAMM_V2_QUOTES=1`. DLMM/DBC/DAMM v2 rows show quotes where pools exist, or `NO_VERIFIED_POOL` — never `SDK_ERROR`.

## 8. Native-vs-SDK comparison (Task 11 gate)

```bash
HENAR_METEORA_DBC_QUOTES=1 HENAR_METEORA_DAMM_V2_QUOTES=1 npm run router:validate
```
Exit 0 and `gatePassed: true` in the printed summary. SDK_BACKED (DBC, DAMM v2) must be exact; CLMM/DLMM rows will report the harness's pending state until the SDK-fetched-state path is wired in the harness (open item).

## 9. Jupiter benchmark

```bash
HENAR_ROUTER_QUOTES=1 npm run router:benchmark -- 100
```
Jupiter column populated; summary shows direct win rate and median delta bps.

## 10. Transaction simulation

Requires the execution flag **for simulation only**, on a build that is never sent:
```bash
HENAR_ROUTER_QUOTES=1 HENAR_ROUTER_EXECUTION=1 npm run router:serve
```
POST `/v1/quote` then `/v1/build` for one small buy ($10). Simulate the returned transaction with `RpcSimulator`; `outputWithinPlan` must be true and `computeUnitsConsumed` recorded — then **unset the flag**. (A `router:simulate` script for this step is an open item.)

## 11. Small transaction build

Same as 10; verify the v0 message: compute budget first, idempotent ATAs, fee `TransferChecked` (amount 15 bps, correct decimals/program), venue leg with the plan floor, no signer other than the wallet.

## 12. Protected submit test — ONLY when explicitly authorized

Requires a written go-ahead, `HENAR_PRIVATE_SUBMIT=1`, a Jito/Jupiter transport configured, a $10 notional, and reconciliation via `reconcileExecution` afterwards. Not before steps 1–11 are green.

## 13. Benchmark matrix

```bash
HENAR_ROUTER_QUOTES=1 HENAR_METEORA_DBC_QUOTES=1 HENAR_METEORA_DAMM_V2_QUOTES=1 npm run router:benchmark:matrix -- 25
```
Sizes $10 → $50,000 across the first 25 enabled representations; `logs/router-matrix.jsonl`.

## Pending gates (all)

| Gate | Task | Status |
|---|---|---|
| Live Raydium CLMM quote | 6 / 7 | pending |
| Live Meteora DLMM quote | 5 | pending (no pool known) |
| DBC / DAMM v2 discovery on mainnet | DBC-10 | pending |
| Live DBC / DAMM v2 quotes | DBC-7/8 | pending |
| Pool on-chain verification pass | 9 prerequisite | script not written |
| Native-vs-SDK comparison | 11 | pending |
| Jupiter benchmark | 8 | pending |
| Simulation (RpcSimulator) | 16 | pending |
| Blockhash provider, LUT provider (RPC) | 14 | pending |
| Jito / Jupiter / RPC transports | 17 | pending |
| Reconciliation against a real signature | 18 | pending |
| WebSocket stream, resync, staleness on real slots | 19 / 20 | pending |
| /ready true on a live worker | 22 | pending |
| Benchmark matrix | 25 | pending |
| UI comparison panel against live quotes | 24 | pending |

## Open items to write before tonight if time allows

1. `scripts/router/verify-pools-onchain.ts` (ONCHAIN_VERIFIED pass).
2. Harness path for CLMM/DLMM using SDK-fetched state (`validate-native.ts`).
3. `scripts/router/simulate-build.ts` for step 10.

## Results

_(fill in tonight; one line per step: date, command, outcome, log path)_
