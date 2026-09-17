"use client";

import { useState } from "react";
import { Sprout } from "lucide-react";
import type { MarketProposal } from "@/lib/dbc/open-market";

/**
 * The offer to open a market for a company Henar cannot trade.
 *
 * Two clicks, because there is nothing to fill in: every parameter of the
 * curve is derived from the company's own reference price, so the reader's
 * only decision is whether to open it at all. The panel exists to show what
 * would be created before that decision, not to collect settings.
 *
 * It is deliberately honest about the last step. Creating a market signs a
 * transaction from an operator wallet today, and saying so here is better
 * than a button that fails at the wallet.
 */

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;

export function OpenMarketCard({ ticker, proposal }: { ticker: string; proposal: MarketProposal }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="open-market">
      <div className="open-market-head">
        <span className="open-market-icon" aria-hidden="true">
          <Sprout size={17} strokeWidth={1.7} />
        </span>
        <div>
          <h2>No market for {ticker} on Henar yet</h2>
          <p>
            {proposal.tokenSymbol} is verified on chain but has no pool with
            usable liquidity. A bonding curve can open one and let the price
            find itself.
          </p>
        </div>
        <button type="button" className="open-market-cta" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "Open a market"}
        </button>
      </div>

      {open && (
        <div className="open-market-body">
          <dl>
            <div>
              <dt>Pair</dt>
              <dd>{proposal.tokenSymbol} / USDC</dd>
            </div>
            <div>
              <dt>Opens at</dt>
              <dd>{usd(proposal.openingPrice)} per token</dd>
            </div>
            <div>
              <dt>Graduates once it raises</dt>
              <dd>{usd(proposal.graduationRaise)}</dd>
            </div>
            <div>
              <dt>Then migrates into</dt>
              <dd>Meteora DAMM v2</dd>
            </div>
          </dl>
          {/* Where the number came from, because a curve sized off a guessed
              price opens at the wrong one and never recovers. */}
          <p className="open-market-basis">
            Opening price tracks the share · {proposal.referenceSource}
          </p>
          <p className="open-market-note">
            Quotable by Henar&rsquo;s router from the moment it exists, because a
            curve pairing a verified representation with USDC is routable while
            it bonds. Creating it signs from an operator wallet.
          </p>
        </div>
      )}
    </section>
  );
}
