# Development log

Henar's work split into what existed before the hackathon and what was built
during it. The boundary is **14 September 2026, 18:00 +03**. Everything before
it is in git history; everything after is this hackathon's work.

Timestamps come from commit dates in this repository. Where work is not yet
committed it is described as in progress and marked as such.

---

## Pre-hackathon (12–14 September 2026, up to 18:00)

31 commits, from the first commit on 12 September at 21:03 to the last
pre-hackathon commit on 14 September at 16:26. This is the product Henar
entered the hackathon with.

### 12 September — foundation

The first day established the product and the trading surface.

- Initial application published (21:03).
- Trade tickets rebuilt on shared layouts with receive-side quotes.
- Limit expiry selection scoped so it only appears for limit orders.
- Native selects replaced with styled menus and mobile drawers.
- Market and DCA tickets centred; schedule controls simplified.
- Branding introduced and the landing page simplified.
- Portfolio and collection unified into **Stockfolio**, with verified receipt
  history.
- **Lucky packs** backed by atomic Jupiter delivery before reveal.

### 13 September — markets, execution and mainnet

- **Unified markets shipped** alongside guarded mainnet execution: the
  company-first model reached the product.
- Branded quote-source logos for execution providers.
- Issuer filters restored in the asset selector.
- Trade confirmation and quote recovery improved.
- Issuer comparison finalised and submission setup completed.
- Security review documentation updated.

### 14 September (to 16:26) — research surfaces and visual system

- **Calendar, sector classification and stock earn pools added**; company
  research streamed (12:26).
- Full theme redesign: pomegranate canvas, real typography, tactile widgets.
- Markets overview rebuilt as a bento of unequal tiles.
- Colour reworked to carry meaning; card outlines dropped; scale increased.
- Every surface neutralised so red reads as data, not decoration.
- Hero globe added, then replaced with `cobe` for a real projection.
- Decorative bar chart removed from Markets; control row tightened.
- Landing hero stripped back to a single idea.
- Mobile pass; the globe dissolves rather than clipping.
- Calendar brought into the same vocabulary as the rest of Markets.
- Landing chart replaced with the unification diagram.
- `redesign-theme` merged to `main` (15:25).
- Calendar's filed results shipped as generated data.
- Duplicated events section removed; any wallet can be viewed read-only (16:26).

### State entering the hackathon

- 1,339 companies and ETFs across 2,212 verified issuer mints.
- Markets, Trade, Earn, Packs and Stockfolio surfaces live.
- Anchor program deployed to mainnet, upgrade authority retained, access
  restricted to a single pilot owner under a cumulative 25 USDC cap.
- 113 tests passing; CI running lint, typecheck, tests and build on every PR.

---

## During the hackathon (14 September 2026, from 18:00)

Work in this period is on the landing page: the surface a judge or a new user
meets first. It was the weakest part of the product going in — a well-made
brand page for a product whose entire claim is data.

**Not yet committed.** 9 files changed (+1,210 / −379) and 6 new components
totalling 492 lines.

### Quote aggregation

- `aggregateIndicativeQuotes` given a 5-second in-process cache, keyed by mint
  pair, amount and slippage, which self-evicts on failure or on a null
  selection. The public estimate endpoint now uses the cached indicative path
  rather than full execution quotes.
- Five Jupiter-proxied venue adapters (Orca, Meteora, Phoenix, OpenBook,
  Lifinity) removed from the aggregate; the four independent providers remain.
- Jupiter test stubs moved from `/swap/v1/quote` to `/swap/v2/order`.

### Landing page rebuild

- **Markets diagram fixed.** The connector curves converged on empty space
  while the brand mark floated separately, and the endpoints missed the issuer
  rows. Three representations now converge into the Henar mark and one line
  leaves it for a single result card. Geometry is derived from fixed row
  constants, so endpoints land on row centres by construction.
- **Coverage section added.** A fanned deck of nine real companies that each
  carry three verified issuer representations, driven by scroll position rather
  than a timer, written straight to the DOM to avoid re-rendering nine tiles per
  frame.
- **Research rebuilt** as four equal cards, each with a fragment of interface
  bled into the card and faded out behind the copy. Fragments carry real issuer
  names, token symbols and SEC form types — and no figures anywhere, so the page
  never asserts a number it has not verified.
- **Trade restructured.** Simple and Pro are two interfaces over the same three
  order types, so they read as a switch above Swap, Limit + Yield and DCA rather
  than a fourth item beside them.
- **Earn rebuilt as a flow** — deposit, yield, stock — since three cards implied
  three options when it is one path. Wording follows `docs/EARN-PACKS.md`: only
  claimable yield is ever spent.
- **Closing ring.** Text on a circular path, turning anticlockwise to match the
  reading direction, pinned to the exact circumference so it closes with no
  seam.
- Hero reduced to a single headline; the closing slogan removed.
- Section dividers replaced with alternating grounds, then dropped once the
  cards carried the structure themselves.
- Scroll-linked globe exit: the sphere grows to 1.95x and dissolves as the hero
  leaves, with an edge scrim so it never meets the clip on a hard cut.

### Performance

- **The hero globe was drawing on every frame regardless of visibility.** It now
  parks when scrolled out of view or when the tab is backgrounded: measured 181
  WebGL draws in 1.5s while visible, 0 once scrolled away.
- **14 elements held `will-change` for the life of the page**, pinning a
  compositor layer each. Layers are now released once the reveal completes.
- The company deck skips its per-frame write when scroll movement is below a
  visible threshold.

### Accessibility

- Issuer row type raised from 9px to 10.5px (label) and 11px to 13px (names),
  logos from 17px to 20px, with contrast lifted to match.
- Section eyebrows and stat labels raised from 10px to 11.5px.
- Verified with no horizontal overflow at 375px and 320px.

### Two class-name collisions found and fixed

- `.bento` was already owned by the Markets overview, so two conflicting rule
  sets applied to both pages.
- `.ring` is a Tailwind utility that paints a 1px box-shadow, which is where the
  stray outline around the closing ring came from.

Landing components now carry an `l` prefix to keep them out of the shared
namespace.
