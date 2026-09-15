# OKX as a second public liquidity / RFQ source

Checked 2026-09-15 against OKX's own developer documentation.

## Recommendation: skip for now, and it is not close

OKX is *accessible* (no enterprise contract needed to start, no private
market-maker relationship) but not usable as a first-class racing source under
the constraints set for this sprint. Two facts decide it.

**1 request per second.** The Trial tier's default rate limit is 1 RPS,
raisable to 5 RPS on review and approval, and the key is valid for **60 days**
from creation. Henar's router races every venue on every quote: a single
200-observation benchmark issues several hundred quotes, and a live quote
endpoint would exceed 1 RPS with a handful of concurrent users. A source that
cannot be asked cannot compete, and a source that expires in 60 days cannot be
depended on.

**OKX keeps the upside on the free tier.** On Trial, when OKX gets a better
price than quoted, "the additional value named positive slippage is kept as
our infrastructure fee", capped at 10% of the trade amount. That is value
taken from Henar's users, which is the opposite of the best-execution property
this sprint exists to improve. On the Start-up tier positive slippage is
returned to users by default, which is the correct behaviour, but reaching
that tier has its own cost below.

## What each tier actually requires

| Tier | How to get it | Rate limit | Cost to Henar |
|---|---|---|---|
| Trial | Developer Portal account, email and phone verified | 1 RPS, up to 5 on approval, expires after 60 days | Free, but OKX retains positive slippage (capped at 10% of trade) |
| Start-up | KYC on the Developer Portal | "much higher RPS" (unspecified) | Standard revenue-sharing agreement: **OKX retains 20% of Henar's partner-fee revenue**; positive slippage returned to users by default |
| Enterprise | Contact the BD team and sign a contract | Negotiated | Negotiated |

Against the stated constraints: no enterprise contract is required (Start-up
is self-serve after KYC), and no private market-maker partnership is involved.
But the Start-up tier is a revenue-sharing contract, and 20% of a 10 bps fee
is 2 bps of Henar's own take on every routed trade. Whether that is worth
paying is a business decision, not a technical one.

## Where it would plug in if the answer changes

The work is small and the shape already exists. OKX would be a `VenueAdapter`
alongside `jupiter` and `openocean`, quoting the same input mint, output mint
and amount, ranked by `compareRanked` on net user output like every other
venue, and classified `EXTERNAL_EXECUTABLE` or `QUOTE_ONLY` by `capabilityOf`
depending on whether its Solana swap-instructions endpoint is wired into the
builder. Nothing about the racing model needs to change to admit it: that is
what the adapter interface is for.

Two integration details worth recording now, since they bear on the
comparison being fair:

- OKX's Solana integration exposes both a quote endpoint and a
  swap-instructions endpoint, so an OKX route could be genuinely executable
  rather than quote-only.
- OKX permits a partner fee of up to 10% per swap on Solana. Henar would set
  it to zero and keep charging its own 10 bps once, or the user would be
  charged twice. That is the same double-fee trap the engine already asserts
  against for native routes, and an OKX adapter must be held to it.

## Revisit when

Either of these changes the answer: Henar's volume justifies KYC and the 20%
revenue share, or OKX publishes a paid tier with a fixed cost and a usable
rate limit that does not touch Henar's fee revenue. Until then, Jupiter
remains the only external source that can be asked on every quote at no
per-trade cost to Henar or its users.

Sources: OKX Wallet DEX API documentation, API Fee and Solana quick-start
pages, retrieved 2026-09-15.
