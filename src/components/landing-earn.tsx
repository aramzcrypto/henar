import { ChevronRight, Coins, Sprout } from "lucide-react";
import { EquityLogo } from "./equity-logo";

/**
 * Earn as one sequence rather than three cards: a deposit becomes yield, and
 * only that yield becomes stock. Three separate cards read as three options,
 * when this is a single path.
 *
 * Wording follows docs/EARN-PACKS.md: only claimable yield is ever spent, and
 * principal and invested shares are untouched by a settlement.
 */
export type EarnStock = { ticker: string; logo: string | null };

export function LandingEarn({ stocks }: { stocks: EarnStock[] }) {
  return (
    <div className="eflow" data-reveal>
      <div className="eflow-step">
        <span className="eflow-node">
          <Coins size={22} strokeWidth={1.6} />
        </span>
        <b>Deposit USDC</b>
        <i>Principal stays yours and can be withdrawn.</i>
      </div>

      <span className="eflow-wire" aria-hidden="true">
        <ChevronRight size={15} strokeWidth={2} />
      </span>

      <div className="eflow-step">
        <span className="eflow-node" data-live>
          <Sprout size={22} strokeWidth={1.6} />
        </span>
        <b>Earn yield</b>
        <i>Held in a Kamino vault and tracked per position.</i>
      </div>

      <span className="eflow-wire" aria-hidden="true">
        <ChevronRight size={15} strokeWidth={2} />
      </span>

      <div className="eflow-step">
        <span className="eflow-stocks">
          {stocks.map((stock) => (
            <EquityLogo
              key={stock.ticker}
              logo={stock.logo}
              ticker={stock.ticker}
              size={38}
            />
          ))}
        </span>
        <b>Yield buys stock</b>
        <i>Only claimable yield is spent, never principal.</i>
      </div>
    </div>
  );
}
