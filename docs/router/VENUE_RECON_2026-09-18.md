# New venue reconnaissance — 18 September 2026

Measured before writing adapters, because the brief's own rule is not to add a
venue that does not contribute fillable liquidity.

## The four venues in the brief

| Venue | Equity liquidity found | Verdict |
|---|---|---|
| **Byreal** | **21 pools** representation/USDC; 19 fill $1,000, **13 fill $50,000** | **Build it.** Real depth, clean SDK. |
| PancakeSwap V3 Solana | No mainnet program id published that I could verify; absent from every Jupiter route observed | Not actionable without a program id |
| Manifest | 7 accounts holding a probed equity mint, out of 3,964 | Thin. Appears in ~1% of Jupiter route legs |
| PumpSwap | 18 pools, equity mint at offset 75 — the **quote** side | These are memecoin/stock pairs, which the brief says to exclude |

Byreal detail is in `src/data/router/byreal-discovery.json`, written by
`npm run router:discover:byreal`. Admission is by executable output at
$100 / $1k / $5k / $10k / $25k / $50k, not TVL.

## What Byreal is actually worth

- **Against Jupiter: 0 of 47.** Median -54 bps, widening with size.
- **Against Henar's own native venues: 7 of 47**, concentrated small:
  +43 bps on COINx at $1,000, +41 on AAPLx at $10,000, 0 of 14 at $50,000.

The reason is visible in Jupiter's own route labels — `TesseraV+Raydium
CLMM+Byreal`, `Riptide+Byreal+Raydium CLMM`. Jupiter does not *choose*
Byreal, it *combines* it. So Byreal is worth racing and worth having as a
third leg in the split optimizer; it is not worth expecting to win alone.

## The larger finding: the gap is not these four venues

Across 84 winning Jupiter routes for Henar's listed equities:

| | Legs |
|---|---|
| Venues Henar can quote (Raydium CLMM/CP, Whirlpool, Meteora DLMM) | 128 |
| **Venues Henar cannot quote** | **71** |

The venues Henar cannot quote are HumidiFi (14), GoonFi V2 (13), ZeroFi (12),
BisonFi (11), Archer (6), Denali (5), BinaryFi (3), Deriverse (2), Scorch (2),
Quantum, Quay, AlphaQ — plus Riptide and TesseraV in wider samples. **Roughly
a third of the flow runs through venues Henar has no adapter for, and not one
of them is in this brief.**

These are closed-source prop AMMs with no SDK. They are ordinary on-chain
programs, so they are reachable — by building their swap instruction from
observed transactions and **pricing it by simulation** rather than by
reimplementing a curve nobody publishes. That is the one integration path that
scales to all of them at once, and it is where the basis points are.

## On "any token with liquidity"

Henar already quotes any Solana token: the market path races Jupiter and
OpenOcean on an arbitrary pair, and SOL, USDT, JLP, JUP, cbBTC, WIF, BONK, RAY,
JTO and PYTH all quote today. What is restricted is the **native** engine,
which covers USDC ↔ verified representation only.

So widening token coverage does not improve a quote — it is already wide. What
improves a quote is venue coverage, which is the table above.
