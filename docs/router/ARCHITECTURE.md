# Henar Equity Router — Architecture

Status: live in production as of 2 October 2026. `HENAR_ROUTER_QUOTES`,
`HENAR_ROUTER_UI` and `HENAR_ROUTER_EXECUTION` are all set in the Vercel
production environment: Henar's own routes are quoted, ranked in the Trade
list against the aggregators, and selectable for execution. Split and path
routing are on by default. [LIVE_VALIDATION.md](LIVE_VALIDATION.md) remains
the gate-by-gate record of what has run against mainnet and what has not;
no native mainnet trade has been recorded there yet.

This document is written as a log. Sections 1–8 describe the system as of
15 September 2026 and some of their statements have since been superseded —
§9 and §10 say what changed and are authoritative where they conflict.

Package map after Tasks 8–25: `router-core` (types, registry, engine,
telemetry, native-state, validation, split), `execution-guard` (Task 9),
`tx-builder` (planner, builder, simulation, submit, reconcile — Tasks
13–18), `apps/router` (state store, stream, worker, health, API, server —
Tasks 19–23), venue packages each with a `native.ts` (Task 10).

Meteora DBC and DAMM v2 (venues `meteora-dbc`, `meteora-damm-v2`) were
added after the hardening pass; see [METEORA-DBC.md](METEORA-DBC.md). They
are quote-only, flag-gated, and validated offline against the official
SDKs; live validation is pending with the rest of §8.

Henar is building its own execution and routing engine for tokenized
equities on Solana. This document records what exists today, what the router
adds, the decisions taken while building it, and what has and has not been
verified. It is the reference for every later task in the plan.

The router is **not** a wrapper around Jupiter. Jupiter remains a benchmark,
a fallback route and possibly a submission service. Henar discovers
liquidity, holds pool state, computes quotes, compares venues, splits orders,
builds transactions and enforces its own safety rules.

Scope for Phases 1–5 is deliberately narrow:

    USDC -> verified tokenized equity
    verified tokenized equity -> USDC

Nothing here generalises to arbitrary Solana tokens.

---

## 1. What exists today

Everything below was read directly from the codebase before any router code
was written. File paths are exact.

### 1.1 Canonical registry

`src/lib/equities/registry.ts` builds the company universe at module load from
`src/data/stocks.json` (2,212 issuer-published mints, catalogued with source
URLs and content hashes in `src/data/catalog-report.json`). Companies are
grouped by underlying ticker:

    Company (1,339)
      -> Representation (2,212)
           provider: xstocks | backpack | ondo
           mint, tokenSymbol, providerStatus: "verified" | "unavailable"

191 companies are issued by all three providers; 491 by two.

Two facts that shape the router:

- **The catalog carries no token program.** `Representation.tokenProgram`
  and `decimals` are `null` from the catalog and are only populated by
  `verifiedRepresentations()` in `src/lib/equities/onchain.ts`, which calls
  `verifiedMint()` (`src/lib/solana.ts`) to read the mint account and assert
  its owner is the Token or Token-2022 program.
- **xStocks mints are Token-2022.** NVDAx
  (`Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`) is owned by
  `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, 8 decimals. It does not use
  ScaledUiAmount today, but `jupiterMetadata()` in
  `src/lib/equities/jupiter.ts` already reads `scaledUiConfig.multiplier`
  for representations that do.

### 1.2 The live Trade path

Only **market swaps** execute on mainnet. Limit and DCA go through the
Anchor program (`programs/stockroom`) via `protocol.run` and are gated by the
on-chain product mask, which currently enables Earn only.

The market path, end to end:

1. Client obtains a signed session (`quoteAuthorization`,
   `src/lib/wallet-access-client.ts`) and `POST`s `/api/market`.
2. `src/app/api/market/route.ts` verifies the session and a per-wallet quote
   budget, resolves the protocol fee account (the treasury's canonical ATA,
   created idempotently with rent disclosed), and fetches
   `https://api.jup.ag/swap/v2/build` with `instructionVersion: V2`,
   `maxAccounts: 48`, retrying with a tighter bound if the route would touch
   unrelated wallet inventory.
3. `validateWalletRoute()` (`src/lib/route-policy.ts`) byte-parses the
   Jupiter RouteV2 instruction: discriminator `bb64facc31c4af14`, exact input
   and quoted output in the fixed header, slippage, zero platform fee, fixed
   account positions, only the owner as signer, at most six setup
   instructions, no "other" instructions.
4. The client re-validates independently (`validateMarketTransaction`,
   `src/lib/market-transaction.ts`), re-reads mint program and decimals from
   chain, runs `inspectRouteWallet`, simulates, **then** signs, sends with
   `skipPreflight: false`, and polls to confirmation.

The Henar fee is `MARKET_FEE_BPS = 15` (`src/lib/trade-fee.ts`), taken on
input when USDC is the input, otherwise on output.

**These four validation layers are the reason the live flow can be trusted.
No router task may weaken them.** The router adds a parallel path behind
feature flags; it does not modify this one until Task 24.

### 1.3 Existing quote aggregation

`src/lib/execution/aggregate.ts` already fans out to four sources —
Jupiter (V2 meta route), Raydium (HTTP `transaction-v1.raydium.io`),
OpenOcean (via QuickNode, optional) and Titan (optional) — with a 5s
indicative cache, ranks by exact output net of provider fees, and exposes
the result at `POST /api/execution/quote`. Its types are in
`src/lib/execution/types.ts`.

This layer is **HTTP quote APIs**. None of it reads pool state. It stays as
the current production routing and the safe fallback (plan §33).

### 1.4 Pool liquidity readers

`src/lib/execution/liquidity.ts` already queries Raydium, Meteora and Orca
pool indexes **by exact mint pair** for TVL, volume and fee data, keyed to
pool addresses. This is the seed for the verified pool registry.

### 1.5 Company-level ranking

`src/lib/equities/routes.ts` — `dexRoute()` and `bestNetRoute()` — already
rank `EquityRoute`s across a company's representations net of provider and
protocol fees, refuse stale quotes, and refuse to compare sells across
different issuer tokens as if they were one balance. Company routing
(Task 9 / plan §9) sits above the venue engine and must remain compatible
with `EquityRoute`.

### 1.6 Database

Supabase is optional (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). One
migration exists (`supabase/migrations/20260913171500_company_research_cache.sql`)
with three tables: `company_research_cache`, `company_news`,
`market_data_runs`. Generated reference data ships as committed JSON
(`src/data/sectors.json`, `src/data/earnings.json`), built by scripts.

### 1.7 Solana access

`connection()` in `src/lib/solana.ts` requires `SOLANA_RPC_URL`. There is no
RPC configured on the development machine used for this phase; anything
that needs chain state is written to run where RPC exists and to fail
closed where it does not.

---

## 2. What the router adds

### 2.1 Package layout

The plan recommends a monorepo (`apps/web`, `apps/router`, `packages/*`).
Phase 1 adopts the package **boundaries** but wires them with TypeScript
path aliases rather than npm workspaces:

    packages/
      router-core/      types, pool registry, quote engine
      venue-jupiter/    benchmark / fallback adapter
      venue-raydium/    direct CLMM adapter (official SDK)
      venue-meteora/    direct DLMM adapter (official SDK)
      execution-guard/  Task 9
      tx-builder/       Tasks 13–16
      shared-types/     reserved

Imports use `@henar/router-core`, `@henar/venue-raydium`, etc.
(`tsconfig.json` `paths`). Next.js and `tsx` both honour these.

**Why aliases, not workspaces.** Workspaces were tested and resolve cleanly,
but they change `npm ci` behaviour and Vercel's install step days before a
judged deadline, for no Phase 1 benefit. The directories are already shaped
as packages; promoting them to real workspace packages is a one-line
`package.json` change when the Phase 5 worker needs a separate deploy.

**Standalone router — known limitation.** The `@henar/*` aliases are
resolved by the Next.js compiler and by `tsx` (both read `tsconfig.json`
`paths`). Plain `node` does not read them. When `apps/router` is deployed
as an always-on process (Phase 5 worker: private submission, reconciliation,
state refresh) it will need its own runtime resolution — either npm
workspaces with real package names, a bundler step (esbuild/tsup) that
inlines the packages, or `tsx` in production. That decision is deferred
deliberately; nothing in Phases 1–4 runs outside Next.js or `tsx`.

### 2.2 Domain model

`packages/router-core/src/types.ts`. Every settlement-relevant amount is a
`RawAmount` — a decimal string of base units, converted to `bigint` in
process. Floats never touch execution amounts; display formatting is a
separate concern (`src/lib/amount.ts`).

Core types: `Venue`, `VerifiedPool`, `RouterRepresentation`,
`QuoteRequest`, `VenueQuote`, `QuoteExclusion`, `EngineResult`,
`ReferencePrice`, `MarketSession`, `ExecutionPolicy`, `Route`, `RouteLeg`,
`SplitRoute`, `ExecutionPlan`, `SimulationResult`, `ExecutionResult`,
`ExecutionStatus`.

Every `VenueQuote` keeps provenance: `source`, `slot`, `quotedAt`,
`expiresAt`, `rawRouteMetadata`. Every rejection is a structured
`UnavailableReason` (plan §10), never free text alone.

Two interfaces:

- `VenueAdapter` — `venue`, `capabilities()`, `health()`,
  `getQuote(request, ctx)`, `buildSwapInstructions(quote, ctx)`.
  In Phase 1 `buildSwapInstructions` returns `NOT_IMPLEMENTED`; Task 14
  fills it.
- `RFQVenueAdapter` — interface only (plan §31). Firm-quote semantics are
  kept distinct from AMM slippage quotes and nothing in Phases 1–5 depends
  on it.

### 2.3 Verified pool registry

`packages/router-core/src/pool-registry.ts` and
`src/data/router/pools.json`, built offline by
`npm run router:pools:build`.

Pools are never discovered by ticker string. Discovery is keyed by
**registry mint**, and a discovered pool is admitted only if both of its
mints match exactly: one must be a `providerStatus: "verified"`
representation mint from the registry, the other must be USDC. Anything
else is rejected and the reason recorded.

Each pool stores the fields the plan requires (`representationId`, `venue`,
`address`, `programId`, `poolType`, `baseMint`, `quoteMint`, fee
configuration, `discoveredFrom`, `verifiedAt`, `enabled`,
`disabledReason`) plus `observedTokenPrograms`, `verification`,
`onchainVerifiedAt` and `verificationDetail`.

**Verification is a state, not a nullable timestamp.**

| `verification`        | Meaning                                                  | `onchainVerifiedAt` |
| --------------------- | -------------------------------------------------------- | ------------------- |
| `DISCOVERED`          | mints matched the catalogue exactly; venue metadata only | must be `null`      |
| `ONCHAIN_VERIFIED`    | mint accounts + pool program re-read from chain agree    | must be set         |
| `VERIFICATION_FAILED` | chain disagreed; pool cannot be enabled                  | must be `null`      |

`validatePool()` rejects any pool whose state and timestamp disagree, and
`isOnchainVerified(pool)` is the only predicate execution code may use —
it requires both the state and the timestamp. The discovery builder writes
every pool as `DISCOVERED`; a separate RPC-gated verification pass (not yet
written, and not runnable on this machine) is the only writer of the other
two states and of the timestamp. Adapters re-check mints and program at
quote time and report `onchainCheckedAtQuote: true` on the quote; they
never invent a registry timestamp. A `DISCOVERED` pool is admitted to
quoting (quotes are comparison-only) and **must** be `ONCHAIN_VERIFIED`
before Execution Guard (Task 9) lets it execute.

Raydium discovery (`scripts/router/discover-raydium-pools.ts`) sweeps all
2,212 verified mints against Raydium's v3 API. Meteora discovery
(`scripts/router/discover-meteora-pools.ts`) is RPC-gated — see §3.2.

### 2.4 Venue adapters

**Jupiter** (`packages/venue-jupiter`) wraps the existing
`quoteJupiter()` (`src/lib/execution/adapters/jupiter.ts`) into the
`VenueAdapter` interface. It is the benchmark and fallback, not a direct
venue. It requires `JUPITER_API_KEY`; the keyless `lite-api.jup.ag` host
serves reference data but not swap quotes.

Three capabilities are kept apart on every adapter (`VenueCapabilities`)
and on every quote (`executionPath`):

| Capability        | Jupiter | Raydium | Meteora | Meaning                                          |
| ----------------- | ------- | ------- | ------- | ------------------------------------------------ |
| `quote`           | yes     | yes     | yes     | can price a swap                                 |
| `legacyExecution` | yes     | no      | no      | executable via the pre-router `/api/market` path |
| `nativeBuild`     | no      | no      | no      | router builds instructions itself (Task 14+)     |

A Jupiter quote therefore carries `executionPath: "legacy-market-api"`,
direct quotes carry `"none"`, and nothing carries `"henar-native"` yet.
The router's `buildSwapInstructions` returns `NOT_IMPLEMENTED` for all
three. Ranking prefers a reachable path only as the last tie-break, after
net output and price impact.

**Raydium** (`packages/venue-raydium`) uses `@raydium-io/raydium-sdk-v2`
0.2.69-alpha: `raydium.clmm.getPoolInfoFromRpc(poolId)` then
`PoolUtils.computeAmountOutFormat({ poolInfo, tickarrayBitmapExtension,
tickArrayCache, amountIn, tokenOut, slippage, epochInfo })`, which returns
`{ allTrade, amountOut, minAmountOut, priceImpact, fee, remainingAccounts }`.
`allTrade: false` maps to `INSUFFICIENT_LIQUIDITY`. Only Concentrated (CLMM)
pools are enabled in Phase 1 because that is the path verified against a
real pool; Standard/CPMM pools are registered but disabled with a reason.

**Meteora** (`packages/venue-meteora`) uses `@meteora-ag/dlmm` 1.9.14:
`DLMM.create(connection, pool)`, `getBinArrayForSwap(swapForY, count)`,
then `swapQuote(inAmount, swapForY, allowedSlippage, binArrays, false)`.

_Bin arrays._ `swapQuote` only walks the arrays it is handed and, with
partial fill off, throws `SWAP_QUOTE_INSUFFICIENT_LIQUIDITY` when it runs
past the last one — a loading limit, not a depth fact. `getBinArrayForSwap`
returns fewer than `count` only when the pair's bitmap has no further
liquidity in that direction. The adapter therefore uses a bounded ladder
(`4 → 8 → 16`): fewer-than-asked means the pool is exhausted; exactly-asked
plus a throw means load more. Past 16 it reports `INSUFFICIENT_LIQUIDITY`
with "adapter bound, not necessarily pool depth" in the detail. 16 keeps
the eventual swap inside one transaction's account limit; a larger order
is a split-routing question (Task 12), not a bigger ladder.

Both direct adapters use the venue's **official SDK quote functions** in
Phase 1 (plan §4: do not reinvent DLMM/CLMM maths before a verified
baseline). Native state readers are Task 10; the SDK results become the
comparison baseline for Task 11.

### 2.5 Quote engine

`packages/router-core/src/engine.ts` — `quoteRepresentation()`.

For a request against one representation it resolves enabled pools per
venue, calls every eligible adapter **concurrently** with a per-venue
deadline, normalises results, applies the Henar fee (§2.6), and returns
`{ best, alternatives, exclusions, quotedAt, slot }`. "Best" in Phase 1
means best expected net output among quotes that carry no
`unavailableReason`. Tie-breaks: lower price impact, then earlier quote.

The engine is behind `HENAR_ROUTER_QUOTES`. Off, it returns an explicit
disabled result. The three other flags (`HENAR_ROUTER_EXECUTION`,
`HENAR_SPLIT_ROUTING`, `HENAR_PRIVATE_SUBMIT`) are reserved for later tasks.

Company-level routing (plan §9) is not in Phase 1. The engine's output is
designed so Task 9 can run it once per eligible representation and rank
across them with `bestNetRoute()` semantics, keeping issuer identity
explicit in the response.

### 2.6 Henar fee

"Best execution" is computed **after** the Henar fee (plan §21). The engine
reuses `MARKET_FEE_BPS` and `tradeFee()` from `src/lib/trade-fee.ts` and
applies them exactly as the live market path does: on input when USDC is the
input (buys), on output otherwise (sells). Venue quotes for buys are
requested on `amount − fee` so the venue sees the amount that will actually
be swapped.

Every ranked quote carries a `FeeBreakdown`:

    userInput ─(henarInputFee, buys only)─▶ venueInput
      ─▶ venue swap (venueFee taken inside the venue) ─▶ grossVenueOutput
      ─(henarOutputFee, sells only)─▶ netUserOutput

with two identities asserted in `rankQuote()` — it throws rather than
rank on a violation:

    userInput        == venueInput + henarInputFee
    grossVenueOutput == netUserOutput + henarOutputFee

and exactly one of `henarInputFee` / `henarOutputFee` may be non-zero.
The first identity is what stops double charging: a venue that quotes the
full user amount on a buy (ignoring the fee-reduced input it was given)
fails the check instead of being ranked with a hidden second fee.
`venueFee` is informational; the venue has already taken it and it is never
deducted again. Ranking key is `netUserOutput`.

---

## 3. Verified facts and open questions

### 3.1 Raydium — verified

Real CLMM pools exist with real depth. Queried by exact mint pair against
`api-v3.raydium.io/pools/info/mint`:

| Pair       | Pools | Deepest TVL |
| ---------- | ----- | ----------- |
| NVDAx/USDC | 10    | $2.14M      |
| SPYx/USDC  | 10    | $2.54M      |
| TSLAx/USDC | 6     | $2.10M      |

Example pool `49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6`: program
`CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` (matches the SDK's
`CLMM_PROGRAM_ID`), `tickSpacing 10`, `tradeFeeRate 1000` (0.1%), mint A
Token-2022, mint B (USDC) legacy Token.

Full sweep (15 September 2026, all 2,212 verified mints, zero HTTP
errors): 310 pools pair a registry mint with USDC exactly — 304 CLMM,
6 CPMM (`CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`), none on the
legacy AMM. Every pool the API returned was an exact `{mint, USDC}` pair;
none was rejected for a look-alike mint. After the $1,000 TVL floor and
the CLMM-only rule, `pools.json` holds all 310 with **102 enabled across
78 representations** (55 xStocks, 47 Backpack, 0 Ondo). Ondo mints have
no Raydium pools at all. Every enabled pool reports the equity mint under
Token-2022 and USDC under legacy Token in venue metadata (still
unconfirmed on chain, see §3.3).

### 3.2 Meteora — not verified

Four public endpoints were tried for equity DLMM pools. Two returned errors,
one ignored the mint filter (returned SOL-USDC, page 1 of 126,892 pools),
and the searchable one returned **zero** hits for NVDAx. The full pair dump
(`dlmm-api.meteora.ag/pair/all`) returned 404.

This is strong evidence that no Meteora DLMM pools exist for xStocks today,
but it is not proof, and the plan does not permit acting on unverified
liquidity in either direction. The adapter is therefore built fully against
the SDK, and discovery uses `DLMM.getLbPairs(connection)` — an
authoritative on-chain listing that requires RPC. Until that runs, the
registry holds **zero Meteora pools** and the adapter reports
`NO_VERIFIED_POOL` for every request. The moment a pool is verified, it
quotes.

### 3.3 Token-2022

xStocks are Token-2022 with no ScaledUiAmount extension observed on the
sampled mints. Plan §7 requires representation metadata to record
extensions and to disable a representation when multiplier state is
uncertain. Phase 1 records `observedTokenPrograms` per pool from venue
metadata and leaves the extension record `null` (= not yet read). Task 9
must refuse execution for any representation whose extension state has not
been read on chain. Raw amounts are used throughout; UI multipliers never
touch execution.

### 3.4 Dependencies

- `@raydium-io/raydium-sdk-v2@0.2.69-alpha` — peer web3.js `^1.95.3`;
  repo pins `1.99.0`. Satisfied.
- `@meteora-ag/dlmm@1.9.14` — peer web3.js `^1.91.6`. Satisfied. Pins
  `@coral-xyz/anchor@0.31.0`; the repo uses `0.32.1`. npm nests the SDK
  copy; CJS resolution keeps them separate. Bundle weight, not a
  correctness risk. Not overridden — forcing the SDK onto a different Anchor
  than it was built against is the greater risk.
- `bn.js@5.2.1` — both SDKs take `BN` amounts.

Neither SDK is imported by the web app's client bundle. They are server /
script only.

---

## 4. Compatibility contracts

These existing shapes are consumed elsewhere and are **not** changed:

- `ExecutionQuoteRequest` / `AggregatedExecutionQuote`
  (`src/lib/execution/types.ts`) and `POST /api/execution/quote`.
- `EquityRoute` and `bestNetRoute()` (`src/lib/equities/routes.ts`).
- `MarketReview` and the whole `/api/market` → sign → send path.
- `Representation` (`src/lib/equities/types.ts`). The router has its own
  `RouterRepresentation` view built from it rather than extending it.

---

## 5. Security invariants inherited

The router inherits, and may only tighten, the invariants the live path
already enforces (plan §27):

- no private keys server-side; the user signs
- allowlisted mints (registry), allowlisted pools (registry), allowlisted
  programs (per adapter: `CLMM_PROGRAM_ID`, `LBCLMM_PROGRAM_IDS.mainnet-beta`,
  Jupiter `ROUTER`)
- checked raw arithmetic, `u64` bounds, explicit rounding
- quote expiry on every executable quote
- fail closed: any failed check is `Unavailable`, never a widened fallback
- no arbitrary instruction data from the user (Task 14 builds from the
  registry and quote only)

---

## 6. Phase gates

Phase 1 is complete when Jupiter, Meteora and Raydium adapters work,
normalised comparison works, only verified pools are quoted, and benchmark
logging exists (Task 8). The remaining gates are as written in the plan
(§30) and are not restated here.

---

## 7. Known risks at the end of Task 7

1. **Raydium and Meteora SDK calls are typechecked, not executed.** The
   adapters compile against the SDKs' own `.d.ts` (`getPoolInfoFromRpc`
   → `computePoolInfo`/`tickData`, `PoolUtils.computeAmountOutFormat`;
   `DLMM.create` → `getBinArrayForSwap` → `swapQuote`) but no RPC is
   configured on this machine, so neither has produced a live quote yet.
   Any runtime shape surprise maps to `SDK_ERROR`, never to a number.
   `tests/router/venue-direct.test.ts` carries a live Raydium test that
   runs only when `SOLANA_RPC_URL` is set; the first green run of it is
   the Phase 1 validation gate (plan §4) and must happen before the venue
   is enabled for anything beyond quote comparison.
2. **Meteora liquidity is unproven** — see §3.2.
3. **On-chain mint verification** for registered pools has not run
   (no RPC here). `onchainVerifiedAt` is `null` everywhere until it does.
4. **The alpha SDK tag.** `0.2.69-alpha` is the current published line for
   Raydium sdk-v2; there is no stable tag. Pinned exactly.
5. **Anchor version multiplicity** in `node_modules` (§3.4).

---

## 8. LIVE DIRECT VENUE VALIDATION PENDING

Status as of 15 September 2026, on the development machine without
`SOLANA_RPC_URL` or `JUPITER_API_KEY` (they live on another device by
design). Nothing below is mocked and nothing is marked passed.

| Check                                                    | State                    |
| -------------------------------------------------------- | ------------------------ |
| Types, lint, unit tests (mock adapters, registry rules)  | pass, this machine       |
| Raydium discovery sweep (HTTP, no credentials)           | done, 310 pools          |
| Meteora DLMM discovery (`DLMM.getLbPairs`, needs RPC)    | **not run**              |
| On-chain pool verification pass (→ `ONCHAIN_VERIFIED`)   | **not written, not run** |
| Raydium live quote via SDK (`tests/router/venue-direct`) | **skipped — no RPC**     |
| Meteora live quote via SDK                               | **no pool to quote**     |
| Jupiter live quote via `quoteJupiter`                    | **not run — no key**     |
| Benchmark `npm run router:benchmark`                     | **not run**              |
| DBC / DAMM v2 offline quote validation vs official SDKs  | pass, this machine       |
| DBC discovery `npm run router:discover:dbc` (needs RPC)  | **not run**              |
| Live DBC / DAMM v2 quotes                                | **not run — no RPC**     |

Remaining live steps, in order, on the machine that has the credentials:

1. `npm test` — the Raydium live test un-skips itself when
   `SOLANA_RPC_URL` is set; it must pass before anything else.
2. `npm run router:benchmark -- 100` — direct vs Jupiter, both sides, on
   the first ten enabled representations; inspect latency and net output.
3. `npm run router:discover:meteora` then `npm run router:pools:build` —
   establishes whether any DLMM equity pool exists.
4. Write and run the on-chain verification pass (Task 9 prerequisite): for
   every enabled pool re-read both mint accounts (program, decimals,
   Token-2022 extensions) and the pool account's program owner; set
   `ONCHAIN_VERIFIED` + timestamp or `VERIFICATION_FAILED` + detail.
   Until then `isOnchainVerified()` is false for all 310 pools.

Phase 1 is not complete until items 1–3 have run and their results are
recorded here.

## 9. Additions of 16 September 2026

### Two-leg paths (`packages/router-core/src/path.ts`)

A representation's deepest market is often its SOL or USDT pool. The registry
already admits those as `ROUTING_LEG`; `INTERMEDIATE_ROUTE` records (the
intermediate's own USDC pools, `router:discover:intermediates`) supply the
USDC-side hop. `composePath` builds the best `USDC → I → representation`
(or reverse) route per qualified intermediate, splitting the representation
side across pools with the same optimizer the split uses, and the engine
reports it as `EngineResult.path`.

Sizing rule: two exact-in swaps in one transaction cannot pass the first
hop's real output to the second. The second hop's input is therefore the
first hop's guard floor; the difference between expected and floor stays in
the user's wallet as `residual`, reported but not counted. The guard checks a
path leg with its hop role (`GuardContext.pathLeg`), the USDC hop with a fixed
`intermediateHopSlippageBps` (10), and the API selects the path only when the
guard's floor equals the amount the path was sized on and the net beats the
split and every direct quote. Plans carry `kind: "path"`, an `intermediate`
ATA, and per-hop pair checks; the client validator checks the hop pairs.

### Simulation gate in production (`gateSimulation`)

`RouterApi.quoteAndBuild` simulates every built transaction as the owner
before returning it. A program error, an output below the plan floor, or an
unreported post state refuses the build with the simulation attached.

### Protected submit (`/api/router/submit`)

`submitWithPolicy` with a Jito bundle transport (`HENAR_PRIVATE_SUBMIT=1`,
`JITO_BLOCK_ENGINE_URL`) and one public RPC fallback. 503 when not
configured; the ticket falls back to its own broadcast.

### Raydium CPMM (`packages/venue-raydium/src/cpmm.ts`)

Same venue id as CLMM, distinguished by `poolType: "cpmm"`; adapters are
chosen by pool type (`adapterForPool`). Planner stamps the program id from
the registry record.

### RFQ (`packages/venue-rfq`)

Firm quotes over a documented JSON protocol, quote-only. No open maker today.

### DBC Studio (`packages/dbc-studio`, `/studio`)

Monitor (reuses `refreshDbcLifecycle`/`dbcMetadata`), configuration engine
over `buildCurveWithMarketCap` + `validateConfigParameters`, the
liquidity-targeted graduation model (constant-product, full-range, MODELED),
a volatility-aware fee profile, and wallet-signed deployment with the mainnet
guard (`deploymentProblems`). See `METEORA-DBC.md`.

## 10. Additions of 25 September to 2 October 2026

The §8 live steps have run. What they found, and what changed as a result.

### Pool verification now checks the pair (`pool-mints.ts`)

The first verification pass passed 587 of 587 pools, which was the tell: it
re-read the accounts but never asked what pair the pool actually trades.
`decodePoolMints` decodes the two mints from the pool account itself at fixed
per-layout offsets (`whirlpool` base 101 / quote 181, `clmm` 73 / 105, `cpmm`
168 / 200), checked against the venue SDKs for all 12 layout cases.
`classifyPoolVerification` now requires that pair to agree, unordered, with
the registry record. A layout that cannot be decoded stays `DISCOVERED`
rather than being trusted, and `ONCHAIN_VERIFIED` is a precondition for
native execution. The registry currently holds 1,512 pools, 700 verified in
the committed snapshot, and the pass runs again on every deploy (`prebuild`).

### Verified mint facts are persisted (`verified-mints.ts`)

`router:verify:mints` writes `src/data/router/mints.json`: 2,369 records, each
with mint, decimals, token program, Token-2022 extensions, the slot read and
the timestamp. Decimals and token program are never inferred or defaulted; a
mint whose facts could not be read stays unverified and is not routable.

### The split reports, it does not decide

`split.ts` used to discard a construction early and charge a fixed 2 bps per
extra leg, which is a policy guess dressed as a cost. It now returns the best
valid construction with `improvementBps`, `costBps` and `netImprovementBps`
from the real incremental cost, and the caller decides.
`DEFAULT_SPLIT_OPTIONS` is `{ granularity: 20, maxLegs: 2, extraLegCostBps: 0,
refineSteps: 60 }`: a coarse marginal allocation followed by a ternary search
on the boundary (`refineBoundary`).

### The intermediate hop asks for what it costs

The fixed `intermediateHopSlippageBps` of 10 described in §9 left dust on
every path. `intermediateHopBps` is now a function of the measured price
impact — `min(ceil(impact + 3), 10)` — and the guard policy carries
`intermediateHopMaxSlippageBps: 10` with `intermediateHopMarginBps: 3`. The
ceiling still does its job: a BROS path whose second leg priced at 912 bps
was refused rather than sized.

### Intermediates are qualified by measurement

`router:qualify:intermediates` probes each candidate with a $10,000 round
trip and admits only those losing under 100 bps: 40 of 157 probed qualified,
recorded in `src/data/router/intermediates.json` with each asset's measured
round-trip loss and, for the rejects, the reason (unsupported token
semantics, transfer fees, no USDC side).

### Selection is by what is obtainable, not by mode

The API used `mode === "execute"` as a proxy for whether a route could be
reached, which let a quote-only candidate hold the incumbent slot and beat a
route the user could actually take. Reachability is now a property of the
verdict:

```ts
export function obtainableNet(
  verdict: GuardVerdict | null | undefined,
): bigint | null {
  if (!verdict || !verdict.approved) return null;
  return capabilityOf(verdict) === "QUOTE_ONLY"
    ? null
    : fromRaw(verdict.quote.netOutput);
}
```

The Trade list ranks every candidate on net output after the 10 bps market
fee, which is charged to Henar's own routes as well so it cannot bias the
comparison, and execution follows that ranking.

### Measured result, and why the headline numbers are withheld

A 196-observation matrix was run on 15 September (sizes $10 / $1k / $10k /
$50k, both sides, the 10 bps fee charged to every candidate, log
`logs/router-matrix-v3-10bps.jsonl`). Its structural findings stand:

- Henar native was approved on 79 of 196 observations, and the approval rate
  falls with size: 38 of 49 at $10, 32 at $1,000, 9 at $10,000, **0 at
  $50,000**. At $50k no native venue even quoted on 27 of 49 rows, and on the
  22 where one did the guard refused it — `PRICE_IMPACT_TOO_HIGH` 18 times,
  `ROUTE_STATE_STALE` 4. That is a liquidity fact about the pools, not a
  routing defect.
- Orca and Raydium contributed almost equally when native was approved (41
  and 38 best-native quotes); Meteora contributed nothing for a listed public
  equity.
- The build-and-simulate gate passed 44 of 46 attempts, the two failures
  being `NO_FUNDED_OWNER`.
- `bestObserved` equalled `bestSelectable` on 178 of 188 rows, so the ranking
  was rarely leaving a better reachable route on the table.

The **win rate against Jupiter from that run is not reported here**, because
the run predates `fc705f9` (17 September). Until that commit the Jupiter
adapter asked only `swap/v2/order`, whose answer is net of Jupiter's own
10 bps platform fee (`feeBps: 10`, confirmed against the live endpoint), while
`swap/v1/quote` carries no such fee. The benchmark therefore recorded Jupiter
about 10 bps below what Jupiter itself would quote on any liquid pair: 25 of
the 79 paired rows sit at exactly +10.01 bps in Henar's favour on the same
pool. Those are an artifact of the endpoint, not an edge.

`bestOfJupiterEndpoints` now asks both endpoints and takes the better answer.
Re-measuring then exposed a second defect in the same direction: ranking
admission read `poolAddress === null` as the mark of an aggregator, so Jupiter
was excluded as `VENUE_NOT_EXECUTABLE` on 116 of 196 observations, every one a
single-hop route. With both fixed, the honest result is in
[BENCHMARK_2026-10-17.md](BENCHMARK_2026-10-17.md): Henar is ahead on 0 of 75
paired observations, exactly ties 23 of them on the same pool, and is selected
only where Jupiter has no route. The pool math is right; the route search is
narrow.

### Supporting fixes

- `request-cache.ts` — a memoizing `Connection` proxy with stable identity
  per connection, epoch invalidation, and eviction of failed reads.
- `src/lib/rpc-limiter.ts` — rate limiting installed under `Connection` via a
  paced `fetch` with `Retry-After` handling, and an `AsyncLocalStorage`
  re-entrancy guard after a nested limiter deadlocked.
- Simulation compared the owner's aggregate balance for a mint instead of the
  destination account named in the plan, and decoded a missing post state as
  zero. Both now read the exact designated account.
- `gate.warm()` — owner discovery inside the freshness window was expiring
  quotes it had just taken (18 of 45 demotions).
- The RFQ adapter demanded exact slippage equality and so rejected firm
  quotes; only `slippageBps > requested` is a mismatch.
