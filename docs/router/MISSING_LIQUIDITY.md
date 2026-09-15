# Missing liquidity — Stage 1 findings

Route forensics for Henar Router V2, 15 September 2026. Every number below is
counted from live responses recorded by `npm run router:forensics` and from
`src/data/router/pools.json`. Nothing here is projected or assumed.

## Headline

**There is no missing public AMM liquidity to discover for tokenized equities.**

Across 48 external route observations in two independent samples, Jupiter
routed **100% through JupiterZ**, its own RFQ network, every time. No public
AMM appeared in a single winning external route — not Orca, not Phoenix, not
Lifinity, not Meteora, and not even Raydium, which Henar already integrates.

The gap between Henar and Jupiter on tokenized equities is **not** discovery of
public pools. It is access to RFQ liquidity, which by construction is not a
program Henar can integrate.

## Evidence

### Sample 1 — production router, 30 companies, $1,000 buys

Jupiter route plan venue frequency:

| Venue | Appearances |
| --- | --- |
| JupiterZ | 24 of 24 that quoted |
| anything else | 0 |

Henar's chosen route: `jupiter` 21, `raydium` 3, no quote 6.

### Sample 2 — `router:forensics`, 14 representations x 3 sizes, buys

42 records: 24 quoted, 18 `NO_ROUTE` (Jupiter 400), 0 transport failures.

| Venue | Appearances |
| --- | --- |
| JupiterZ | 24 of 24 |

- **Multi-hop routes: 0.**
- **Intermediate mints: 0.**
- Sizes covered: $10, $1,000, $10,000 — JupiterZ at every size.

All 18 `NO_ROUTE` cases were **Backpack** representations. Jupiter has no route
for those mints at any size.

## What this means for the V2 plan

Three premises in the V2 brief are not supported by the data:

1. **"More AMMs, more pools."** No AMM other than Raydium carries any of this
   flow, and Raydium never won an external route. Adding Orca, Phoenix,
   Lifinity or OpenBook adapters would add venues that lose.
2. **"Multi-hop paths, better intermediate-token selection."** Zero of 24
   winning external routes used an intermediate. A liquidity graph with
   one- and two-hop search would be searching for paths that do not exist for
   these assets. USDC -> SOL -> stock is not how this flow moves today.
3. **"Finer split routing."** The external best route is a single 100% leg in
   every observation. There is nothing to split against.

The one premise that **is** supported: *"public RFQ/PropAMM liquidity exposed
through aggregators."* That is precisely JupiterZ, and Phase F permits using it
through a public API. Henar already does: it routes to Jupiter in 21 of 30
production quotes.

## Registry audit (V2-1)

`src/data/router/pools.json`, committed snapshot:

| Metric | Value |
| --- | --- |
| Pools | 310 |
| Venues represented | Raydium only |
| Pool types | 304 CLMM, 6 CPMM |
| Programs | `CAMMCzo5…` 304, `CPMMoo8L…` 6 |
| Enabled | 102 |
| Disabled | 208 |
| Representations covered | 100 |

Disabled reasons: **202 pools below the $1,000 TVL floor**, 6 Raydium CPMM
"no direct adapter; reachable via Jupiter only".

Coverage per representation:

| Enabled pools | Representations |
| --- | --- |
| 0 | 22 |
| 1 | 58 |
| 2 | 16 |
| 3 | 4 |

**58 of 100 representations have exactly one enabled pool**, so split routing
has nothing to split across for the majority of the book. 22 have none.

Per issuer:

| Provider | Pools | Enabled | Representations | With >=1 enabled pool |
| --- | --- | --- | --- | --- |
| xStocks | 168 | 55 | 52 | 40 |
| Backpack | 142 | 47 | 48 | 38 |
| **Ondo** | **0** | **0** | **0** | **0** |

Two gaps stand out, and neither is a missing venue adapter:

- **Ondo has no pools in the registry at all.** Ondo representations quote via
  Jupiter but Henar's own engine can never serve them.
- **Four venue adapters have zero pools.** Orca Whirlpool, Meteora DLMM,
  Meteora DBC and Meteora DAMM v2 are implemented and carry no registry pools,
  which is why a quote for AAPLx returns `NO_VERIFIED_POOL` from all four.

The cause is the discovery step: the registry is built from the pools Jupiter's
route plan uses at build time. Since Jupiter's plans are JupiterZ-only, the
discovery pass finds no AMM pools to admit, and the registry is left with
whatever the earlier Raydium-specific discovery collected.

## Ranked candidate sources

Ranked by evidence of appearing in winning external equity routes, then by
implementation cost.

| Rank | Source | Evidence in winning routes | Verdict |
| --- | --- | --- | --- |
| 1 | JupiterZ (via Jupiter API) | 24 of 24 | **Already reachable.** Public RFQ through a public API; keep routing to Jupiter when it wins. |
| 2 | Raydium CPMM | 0 appearances; 6 pools in registry, all below TVL floor | Adapter would unlock 0 enabled pools today. **Not justified.** |
| 3 | Orca Whirlpool | 0 | Adapter exists, 0 pools. Fix discovery, not the adapter. |
| 4 | Meteora DLMM / DBC / DAMM v2 | 0 | Adapters exist, 0 pools. Same. |
| 5 | Phoenix, OpenBook, Lifinity | 0 | **Not justified.** No evidence of equity flow. |
| 6 | Riptide and other MM-style DEXes | 1 observation outside these samples (NVDAx, 90%) | Investigate only; typically closed programs that price off-chain. |
| 7 | DFlow, OKX | Not yet measured | Evaluate access and cost before any integration. |

`OPTIONAL_FUTURE_SOURCE`: Titan (paid API), private RFQ networks, issuer
primary markets (Backpack mint/redeem, Ondo primary) — all require commercial
terms, accounts or eligibility that the V2 constraints exclude.

## Recommended next step

Stage 2 as written — liquidity graph, dynamic intermediates, one- and two-hop
search — is **not** supported by this evidence and would add machinery for
paths that do not exist in this market. The measurements that would change that
conclusion are listed under "How to falsify this" below.

Higher-value work, in order:

1. **Fix discovery so the four idle adapters get pools.** Discovery currently
   admits only what Jupiter routes through; since that is JupiterZ, it admits
   nothing. Enumerate Orca and Meteora pools directly by mint pair instead.
   This is the single change that would give the engine more than one pool per
   representation.
2. **Add Ondo representations to discovery.** Zero registry coverage today.
3. **Resolve the `bestQuote` discrepancy.** For AAPLx, `alternatives` reported
   Jupiter at 301,276,904 and Raydium at 301,249,198, while `bestQuote`
   reported Raydium at 301,423,031 and `route` chose Raydium. `compareRanked`
   sorts on net output first, so a lower-output venue winning needs an
   explanation. This is the field the best-execution claim rests on.
4. **Re-run forensics on sells and at $25k/$50k.** Buys only, three sizes so
   far. A larger size may push Jupiter off RFQ and onto AMMs, which would
   change the whole conclusion.

## How to falsify this

This report is built on 48 buy-side observations. It should be revisited if:

- sell-side routes use AMMs where buys use RFQ;
- sizes above $10,000 push external routers onto public pools;
- an external router other than Jupiter (DFlow, OKX) routes equities through
  AMMs that Jupiter does not;
- JupiterZ coverage narrows and AMM pools start appearing in plans.

`npm run router:forensics -- <limit> <sizes>` regenerates the evidence;
`logs/route-forensics.jsonl` holds one record per observation.
