# Router benchmark — 17 October 2026

Run `2026-10-17T11:48:47.346Z`, log `logs/router-matrix-v5.jsonl`, schema
`henar.router.matrix.v3`. 25 representations x 4 notionals ($10 / $1,000 /
$10,000 / $50,000) x BUY + SELL = **196 observations** (100 buys, 96 sells; 4
sells skipped for want of a verified reference price). 6,358 RPC calls through
one serialised queue, **0 observations lost to rate limiting**. The 10 bps
Henar fee is charged to every candidate, Henar's own routes included, so it
cannot tilt the comparison.

This run supersedes every earlier matrix on anything involving Jupiter. Two
defects had to be fixed before the comparison meant anything, and both of them
flattered Henar:

1. **Jupiter was quoted at a discount.** Until `fc705f9` the adapter asked only
   `swap/v2/order`, which prices `outAmount` net of Jupiter's own 10 bps
   platform fee (`feeBps: 10`); `swap/v1/quote` charges nothing. Jupiter was
   recorded about 10 bps below its own price on every liquid pair. In the
   15 September matrix 25 of 79 paired rows sat at exactly +10.01 bps in
   Henar's favour, on the same pool Jupiter had routed through.
2. **Jupiter was removed from the ranking for naming its pool.** Admission read
   `poolAddress === null` as the mark of an aggregator. Jupiter reports `ammKey`
   whenever it routes through a single pool, so it was excluded as
   `VENUE_NOT_EXECUTABLE` on **116 of 196** observations, every one of them
   single-hop — the routes where it competes hardest. Fixed in `d95bfea`.

With both fixed, Jupiter is present on 192 of 196 observations and excluded as
non-executable on none.

## 1. Henar does not beat Jupiter on price

Of the 196 observations, 75 had both an approved Henar-native route and an
approved Jupiter quote. **Henar was ahead on 0 of those 75.**

|                 | bps            |
| --------------- | -------------- |
| Best case       | 0.00 (a tie)   |
| Within 1 bps    | 25 of 75 (33%) |
| Within 5 bps    | 32 of 75 (43%) |
| Within 10 bps   | 41 of 75 (55%) |
| Within 25 bps   | 58 of 75 (77%) |
| Median          | −7.21          |
| Mean            | −14.56         |
| 10th percentile | −40.39         |
| Worst case      | −74.83         |

By side, sells are much closer than buys: median −3.46 bps on sells against
−17.78 bps on buys. Neither side ever wins.

Any earlier claim of a Henar win rate against Jupiter — including the figures
in `HACKATHON_LOG.md` and the ones previously quoted in the README — came from
runs with one or both defects above and should be read as withdrawn.

## 2. The quote math is exact; the route search is narrow

23 of the 75 paired observations are **exact ties, to the integer**, and in all
23 Henar and Jupiter had chosen the same pool. When the two engines price the
same liquidity they agree to the unit: the CLMM and Whirlpool math, the
Token-2022 handling, the fee accounting and the decimals are right.

Henar loses on the other 52 because Jupiter found a route Henar does not
consider. Jupiter reported a multi-hop route on 56 of 196 observations. Henar's
split optimizer opened a second leg on 24, and its two-leg path construction
produced nothing at all in this run. The deficit is breadth of search, not
quality of pricing — which is a more tractable problem, and a different one
from the story the earlier numbers told.

## 3. Where Henar is selected, it is selected on availability

Henar native was the best selectable route on 27 of 196 observations: 9% of
buys, 19% of sells, 33% at $10 and 0% at $50,000. Jupiter took 140, and 29 had
nothing selectable at all. Every one of those 27 is a row where Jupiter either
did not quote or was itself refused — not a row where Henar priced better.

## 4. Depth, not routing, is the binding constraint at size

Native approval falls away as size rises, and the reason is that the pools are
not there:

| Notional | Native approved | No native venue quoting at all |
| -------- | --------------- | ------------------------------ |
| $10      | 35 of 49        | 8                              |
| $1,000   | 26 of 49        | 12                             |
| $10,000  | 12 of 49        | 20                             |
| $50,000  | 2 of 49         | 32                             |

Where a native venue did quote and was refused, the guard refused it for cause:
`PRICE_IMPACT_TOO_HIGH` 51 times (Raydium 31, Orca 17, Meteora 3) and
`ROUTE_STATE_STALE` 12. Those are correct refusals. A route that would move the
pool that far is one the user should not be given.

## 5. Venues and the gate

Raydium and Orca contribute almost equally: 39 and 36 best-native quotes.
Meteora produced no approved native quote for a listed public equity, matching
every previous run. The build-and-simulate gate ran 28 times and passed 27, the
one failure being `NO_FUNDED_OWNER` — an unfunded benchmark wallet, not a route
defect. `bestObserved` differed from `bestSelectable` on 4 of 196 rows, so the
ranking is rarely leaving a better reachable route unselected.

## 6. What this says to do next

- The pricing engine is correct and does not need work. The ranking now
  includes the aggregator it is measured against, which it did not before.
- Closing the gap means searching more routes, not pricing better: multi-hop
  shapes beyond the current two-leg path, and intermediates that actually
  produce a path (none did here).
- Selling Henar as cheaper than Jupiter is not supportable on this evidence.
  What is supportable: Henar quotes its own liquidity from chain, reproduces
  the best shared pool exactly, refuses routes it cannot execute, and reaches
  assets and sizes where no aggregator route exists.
