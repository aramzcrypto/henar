# Where the router actually loses — measured 16 September 2026

Supersedes the conclusions of `MISSING_LIQUIDITY.md` (15 September). That
report found Jupiter routing 100% through JupiterZ, no AMM in any winning
route, and zero multi-hop. **None of that is true today.** Every number below
comes from live production quotes and live Jupiter quotes taken this session.

## 1. The gap, in basis points

Henar's production quote versus Jupiter's own public quote, same pair, same
size, USDC in. Negative means Jupiter delivers more to the user.

| Notional | Observations | Median | Henar wins | Worst |
| --- | --- | --- | --- | --- |
| $1,000 | 12 equities | **-13.0 bps** | 1 of 12 | -19.8 |
| $10,000 | 12 equities | **-18.2 bps** | 5 of 12 | -21.4 |
| $1,000 | 4 crypto | -9.4 bps | 0 of 4 | -12.3 |
| $10,000 | 3 crypto | -10.8 bps | 0 of 3 | -11.4 |

Henar's figure is net of its own 10 bps fee and Jupiter's is gross, because
that is the choice a user actually faces. Fee-neutral, the routing gap is
about **-3 bps at $1,000 and -8 bps at $10,000** on equities, and **zero on
crypto**.

Zero on crypto is not a compliment. Henar selected `jupiter` in 7 of 7 crypto
observations and 21 of 24 equity observations. Where Henar resells a Jupiter
route it cannot beat Jupiter: it is Jupiter's price minus Henar's fee, by
construction. The only rows Henar wins are the ones its own engine wins.

## 2. Which venues win, and which Henar has

78 winning Jupiter routes across 40 listed equities at $1,000 / $10,000 /
$50,000. Percentage of routes each venue appears in:

| Venue | Share | Henar |
| --- | --- | --- |
| Raydium CLMM | 72% | **integrated**, 188 pools enabled |
| Orca Whirlpool | 41% | **integrated**, 98 pools enabled |
| HumidiFi | 23% | no |
| BisonFi | 14% | no |
| TesseraV | 13% | no |
| Meteora DLMM | 13% | adapter exists, **zero public-equity pools in the registry** |
| GoonFi V2 | 12% | no |
| ZeroFi | 12% | no |
| Archer | 10% | no |
| Raydium CPMM | 9% | adapter exists and is wired, **zero pools enabled** |
| Kipseli | 9% | no |
| AlphaQ, Scorch, Manifest, BinaryFi, Quantum | 1–5% | no |

The two venues that carry most of the flow are already integrated. Adding a
third AMM is not where the basis points are.

## 3. Splitting is where the basis points are

Distinct venues in a winning Jupiter route, by size:

| Notional | Mean venues |
| --- | --- |
| $1,000 | 1.15 |
| $10,000 | 2.73 |
| $50,000 | 3.27 |

Henar cannot match this today, for two reasons in its own code:

- `DEFAULT_SPLIT_OPTIONS.maxLegs` is **2**.
- Only two adapters implement `curve()` — Raydium and Orca. The optimizer
  splits across curves, so Meteora DLMM, DAMM v2, DBC and every aggregator
  can never be a leg, whatever the registry holds.

This explains the shape of the measurement: the gap widens from -3 bps to
-8 bps between $1,000 and $10,000, exactly where Jupiter goes from one venue
to three.

## 4. Two registry holes that are pure bookkeeping

- **No public-equity Meteora DLMM pool exists in `pools.json` at all** —
  not disabled, absent. All 182 DLMM rows are PreStocks or Tessera. Discovery
  never scans Meteora for equity pairs, yet Jupiter routes 13% of equity flow
  through Meteora DLMM.
- **All 66 Raydium CPMM pools are disabled**, 9 of them with the reason "No
  direct adapter for Raydium cpmm; reachable via Jupiter only". That reason is
  stale: `raydiumCpmmAdapter` exists and is registered in the production quote
  path. The other 57 are genuinely below the $1,000 TVL floor.

## 5. Coverage and capacity

- 42 of 120 Jupiter equity requests returned no route at any size. Those
  representations cannot be quoted by anyone, Henar included.
- Henar's public quote endpoint returned HTTP 429 after roughly 30 quotes in
  a benchmark. `consumePublicQuoteBudget` is sized for a product, not for an
  aggregator being compared against.

## 6. What the evidence supports, in order

1. **Raise `maxLegs` and implement `curve()` on the remaining adapters.**
   Biggest measured gap, entirely inside Henar's own code, no third party.
2. **Discover Meteora DLMM pools for public equities.** A venue Henar already
   has an adapter for, carrying 13% of the flow, with zero registry rows.
3. **Re-enable Raydium CPMM.** The adapter is wired; the disable reasons are
   stale. Unlocks up to 9 pools today.
4. **Stop charging the fee on resold aggregator routes, or cut it.** On crypto
   Henar is Jupiter minus 10 bps in every observation. This is a pricing
   decision, not an engineering one, and no amount of routing work changes it.
5. **The market-maker tier (HumidiFi, ZeroFi, BisonFi, GoonFi, TesseraV,
   Kipseli, Archer) is not an adapter you can write.** These quote off-chain
   through permissioned programs and are reachable only through an aggregator
   that has a relationship with them. This is the part of
   `MISSING_LIQUIDITY.md` that still holds.

## How to reproduce

The comparison harness is not committed; it issues production quotes against
`/api/market/estimate` and Jupiter's `lite-api` quote endpoint for the same
mint pair, size and side, and compares net output. `npm run router:benchmark:matrix`
covers the same ground with a native-engine breakdown but needs
`JUPITER_API_KEY` and `SOLANA_RPC_URL` locally.
