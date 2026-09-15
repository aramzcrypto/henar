# Execution safety parity: /api/market versus the Router Execution Guard

An audit of what each execution path actually enforces today, so unifying
them is a list of named gaps rather than a rewrite. Read before touching
`src/app/api/market/route.ts`: it is the live trade path.

## What each path enforces

| Protection | Router Execution Guard | /api/market | Gap |
|---|---|---|---|
| Verified input/output mints | `scope.usdcEquity`, pair must be exactly {USDC, verified representation} | Asserts `build.inputMint`/`outputMint` match the request, programs taken from the catalogue record | Both covered |
| Representation verification | `representation.active` refuses anything not ACTIVE | Uses the catalogue record; no explicit status refusal on the quote path | **Missing** |
| Amount integrity | `rankQuote` refuses a venue that quoted different terms; fee accounting asserted | `build.inAmount !== swapAmount` throws | Both covered |
| minOut | Guard derives the floor from policy slippage and the plan asserts it per leg | `otherAmountThreshold > 0` and a fixed `slippageBps === 50` | Partial: floor is not policy-derived |
| Quote freshness | `quote.age` against `maxQuoteAgeMs` plus `expiresAt` | Sets `expiresAt` at +20s; no age assertion before build | **Partial** |
| Chain-state freshness | `state.slotAge` against `maxStateAgeSlots` | Not applicable (no pool state read) | By design |
| Reference-price divergence | `reference.divergence` against `maxReferenceDivergenceBps` | None | **Missing** |
| Market-session awareness | `session.open` when `requireOpenSession` | None | **Missing** |
| Price-impact ceiling | `price.impact` against `maxPriceImpactBps` | None | **Missing** |
| Double fee | Engine asserts fee accounting; one constant for both paths | Refuses a route whose `platformFee.feeBps !== 0` | Both covered |
| Transaction / instruction validation | `validateRouterTransaction` on the built plan | `validateWalletRoute` plus `inspectRouteWallet`, which refuses a route touching unrelated wallet inventory | Both covered; /api/market's wallet-inventory check is the stronger of the two and should move to the shared path |
| Wallet session and budget | Not applicable | `verifyQuoteAccess` plus `consumeQuoteBudget` | /api/market only |
| Balance sufficiency | Not applicable (simulation covers it) | Explicit pre-check | /api/market only |

## The four real gaps

Ranked by what they protect against:

1. **Reference-price divergence.** A stock quote 4% away from its reference
   price is the failure mode that matters most for tokenised equities, and the
   external path has no such check. The guard already implements it
   (`maxReferenceDivergenceBps`, default 200).
2. **Market-session awareness.** The guard can refuse a trade when the
   underlying session is closed; `requireOpenSession` is off by default, so
   this is a policy decision as much as a code one.
3. **Price-impact ceiling.** `maxPriceImpactBps` (default 150) has no
   equivalent on the external path.
4. **Quote freshness as an assertion**, not just an advertised expiry.

## What must NOT be unified

The guard's pool checks are already correctly scoped: `AGGREGATOR_VENUES` is
excluded from both the registry block (`pool.registered`,
`pool.eligibility`, `pool.venue`, `pool.onchainVerified`, `pool.liquidity`)
and the `state.slotAge` check. An RFQ or aggregator route has no public pool
to verify and no pool state to age, so demanding AMM-pool verification of it
would refuse every RFQ route for a property it cannot have. That exemption
stays.

## Shape of the fix

The checks above are pure functions of a quote, a policy and a context. The
unification is to extract the venue-independent half of `guardQuote` — scope,
representation status, freshness, price impact, slippage, reference price and
session — and call it from both paths, leaving the pool and venue-specific
blocks where they are. `/api/market`'s wallet-inventory inspection should move
the other way, into the shared path, since a native route can touch unrelated
inventory just as an external one can.

Not done yet, deliberately: this is the live trade path, and the sprint's own
rule is to measure before adding another layer.
