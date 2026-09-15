# Router V2 benchmark matrix (Item 3)

Run `2026-09-15T17:14:41.793Z`, log `logs/router-matrix-v2.jsonl`, schema
`henar.router.matrix.v2`. 25 representations x 4 notionals ($10 / $1,000 /
$10,000 / $50,000) x BUY + SELL = **196 observations** (100 buys, 96 sells; 4
sells skipped for want of a verified reference price). No observation from any
earlier run is included: the aborted, unpaced 23-row run is kept separately as
`logs/router-matrix-v2-aborted-unpaced.jsonl` and is not aggregated.

Harness state: 3,660 RPC calls through one serialised queue, **0 observations
lost to rate limiting after retries** (two prior attempts died at 35/350 and
23/196 on a single fatal RPC 429).

## 1. Who wins

| Notional | Side | n | Jupiter | Henar Native | Other | Nothing selectable | RFQ flagged |
|---|---|---|---|---|---|---|---|
| $10 | buy | 25 | 96% | 0% | 0% | 4% | 0% |
| $10 | sell | 24 | 100% | 0% | 0% | 0% | 0% |
| $1,000 | buy | 25 | 96% | 0% | 0% | 4% | 0% |
| $1,000 | sell | 24 | 100% | 0% | 0% | 0% | 0% |
| $10,000 | buy | 25 | 92% | 0% | 0% | 8% | 0% |
| $10,000 | sell | 24 | 96% | 0% | 0% | 4% | 0% |
| $50,000 | buy | 25 | 92% | 0% | 0% | 8% | 0% |
| $50,000 | sell | 24 | 92% | 0% | 0% | 8% | 0% |

Best **observed** venue, ignoring reachability: Jupiter 185, OpenOcean 2,
nothing 9. Jupiter quoted successfully in 187 of 196 observations and was
approved in **100%** of those.

## 2. Nothing good is unreachable

`bestObserved` equalled `bestSelectable` in 194 of 196 observations. Only two
rows, both at $10, had any gap at all (max 38.66 bps). At $1,000, $10,000 and
$50,000 the gap was **exactly zero in every row**.

There is no pool the router can see but cannot use. Discovery is not the
constraint.

## 3. Henar Native was never reachable, and the reason is policy

Native was approved **0 times in 196 observations**. Raydium quoted 117 times
and Orca 84 times; neither was ever approved. The single failing guard check,
confirmed directly, is:

```
raydium approved=false reason=ROUTE_STATE_STALE
  FAILED pool.onchainVerified: ROUTE_STATE_STALE — verification DISCOVERED
```

All **587** pools in `src/data/router/pools.json` carry `verification:
"DISCOVERED"`. `DEFAULT_EXECUTION_POLICY.requireOnchainVerifiedPool` is `true`
and `isOnchainVerified()` demands `ONCHAIN_VERIFIED` with a timestamp, so every
Henar-held venue is refused before liquidity, impact or price is considered.

Consequence: **the question "at what size does Native stop outperforming RFQ"
has no answer in this data, and cannot have one until pool verification runs.**
Native does not lose to RFQ at some size; it is not selectable at any size.

### A harness error that hid this behind a second cause

The first pass of this run also fed the guard the per-representation snapshot
slot as the *current* slot. The guard requires `currentSlot >= quote.slot`, and
a quote taken after the snapshot is always ahead of it, so 201 of 201 native
quotes were refused as stale with the quote slot 1 to 218 slots *ahead* of the
clock they were judged against. That was a defect in the benchmark, not in the
venues. It is fixed: the guard now receives a freshly read slot per
observation, recorded as `guardSlot` alongside `snapshotSlot`. With the clock
corrected, the refusal persists for the unrelated reason above.

## 4. Henar direct quote math versus Jupiter

`differenceBps` is negative when Jupiter delivers more. Medians only; see the
data-quality note below.

| Notional | Side | Henar wins | median | p90 | p10 |
|---|---|---|---|---|---|
| $10 | buy | 0% | -10.00 | -9.72 | -21.97 |
| $10 | sell | 12% | -10.00 | 1.67 | -11.50 |
| $1,000 | buy | 0% | -10.05 | -7.14 | -33.06 |
| $1,000 | sell | 8% | -10.12 | -9.78 | -34.48 |
| $10,000 | buy | 16% | -9.99 | 10.00 | -79.06 |
| $10,000 | sell | 12% | -10.47 | -7.27 | -142.59 |
| $50,000 | buy | 32% | -14.12 | 51.00 | -215.15 |
| $50,000 | sell | 21% | -237.60 | 187.52 | -2783.90 |

Restricted to rows where the direct quote was actually **approved**, the median
gap is flat across every size: **-10.0, -10.06, -10.05, -10.65 bps** at $10,
$1k, $10k and $50k respectively.

**Data quality:** means are unusable at $50,000. Nine rows carry
`|differenceBps| > 1000`, all of them unapproved OpenOcean quotes with 55% to
93% price impact (the guard refused them correctly; `differenceBps` compares
the first non-Jupiter verdict whether approved or not). Two HTZ rows reach
2,090,936 bps. Medians are unaffected.

## 5. The 15 bps fee, isolated

The comparison above is net of Henar's 15 bps; Jupiter as quoted here charges
none. Removing the fee moves the median by exactly 15 bps:

| Notional | median net | median gross | Henar would win at 0 bps | at 15 bps |
|---|---|---|---|---|
| $10 | -10.00 | **+5.00** | 92% | 6% |
| $1,000 | -10.05 | **+4.95** | 75% | 4% |
| $10,000 | -10.07 | **+4.93** | 65% | 11% |
| $50,000 | -23.45 | -8.45 | 42% | 23% |

Henar's own routing math is roughly **5 bps better than Jupiter** at $10
through $10,000, and the 15 bps fee converts that lead into a 10 bps deficit.
The fee, not the routing, decides the comparison at every size below $50,000.
At $50,000 the direct venues genuinely lose on depth and the fee is no longer
the deciding term.

## 6. Availability

- Nothing selectable: **9 of 196 (5%)**, every one of them a Jupiter
  `VENUE_UNHEALTHY` coinciding with no usable alternative. Four are LASE buys
  at all four sizes with no other venue quoting at all; the rest are AMC, GPRO
  and HTZ at $10k or $50k where the only other quote was refused for price
  impact. All nine are Backpack representations.
- Rate-limited after retries: **0 of 196**.
- Multi-hop reported on 105 of 196; split legs on 1; **no intermediate mints
  in any observation**, so nothing routed through a non-USDC leg.

| Venue | Quoted | Approved | Best observed |
|---|---|---|---|
| OpenOcean | 190 | 112 (59%) | 2 |
| Jupiter | 187 | 187 (100%) | 185 |
| Raydium | 117 | 0 (0%) | 0 |
| Orca | 84 | 0 (0%) | 0 |

Meteora contributed nothing: `NO_VERIFIED_POOL` in all 196 observations, and
DBC and DAMM v2 are flag-disabled in all 196.

## 7. Classification: CASE C

The gap to Jupiter is not undiscovered liquidity and not routing intelligence.
Best observed equals best selectable in 99% of observations, no observation
routed through an intermediate mint, and Henar's raw quote math is ahead of
Jupiter's by about 5 bps up to $10,000. Two things cost the comparison:

1. **The 15 bps fee**, which is larger than the entire routing edge at every
   size below $50,000.
2. **Pool verification**, which makes Henar Native unreachable in 100% of
   observations, leaving only quote-only and external venues to compete.

Neither is a liquidity-sourcing problem. Both are internal and under Henar's
own control.

Open, unanswered by this run:

- The Native-versus-RFQ crossover size, pending pool verification.
- RFQ was flagged in 0 of 196 observations, against earlier forensics showing
  JupiterZ on 100% of 48 routes. The `rfq` detector reads route metadata that
  the `/swap/v2/order` response may not expose in the same shape; the flag
  should be treated as unmeasured here, not as evidence RFQ was absent.
