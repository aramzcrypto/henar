"use client";
import { LUCKY_OUTCOMES } from "@/lib/lucky";
import { formatUnits } from "@/lib/amount";
export type OpeningMode = "random" | "lucky";
export function LuckyMode({
  mode,
  onChange,
  stake,
  enabled,
}: {
  mode: OpeningMode;
  onChange: (mode: OpeningMode) => void;
  stake: bigint;
  enabled: boolean;
}) {
  return (
    <div className="lucky-mode">
      <div className="product-segments" aria-label="Pack opening mode">
        <button
          aria-pressed={mode === "random"}
          onClick={() => onChange("random")}
        >
          Random
        </button>
        <button
          aria-pressed={mode === "lucky"}
          onClick={() => onChange("lucky")}
        >
          Lucky <span className="lucky-mode-badge">Optional</span>
        </button>
      </div>
      {mode === "random" ? (
        <p>Full stock budget after fees. Random stock.</p>
      ) : (
        <>
          <div className="lucky-range">
            <span>Per pack allocation</span>
            <strong>
              {formatUnits(stake / 4n, 6)}–{formatUnits(stake * 2n, 6)}{" "}
              <small>USDC</small>
            </strong>
          </div>
          <p>55% chance of a reduced allocation. Bank or roll once more.</p>
          <details className="lucky-odds">
            <summary>
              Odds &amp; fees <span>95% average return per roll</span>
            </summary>
            <table>
              <caption className="sr-only">Lucky payout probabilities</caption>
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Chance</th>
                  <th>USDC</th>
                </tr>
              </thead>
              <tbody>
                {LUCKY_OUTCOMES.map((o) => (
                  <tr key={o.label}>
                    <td>{o.label}</td>
                    <td>{o.probability}%</td>
                    <td>{formatUnits((stake * o.quarters) / 4n, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Multipliers apply after the pack fee. The fee is charged once on
              Lucky opening and is non-refundable. Average return is
              theoretical, not guaranteed. Another roll risks the current
              allocation and reduces its expected value by 5%.
            </p>
            <p>
              Network, randomness and stock execution costs are separate.
              Rollover depends on available reserves. Earned packs use Random
              mode.
            </p>
          </details>
          {!enabled && (
            <p className="lucky-availability">
              Lucky opening is not available yet. Sealed packs remain
              refundable.
            </p>
          )}
        </>
      )}
      <small className="lucky-mode-note">
        Choose your mode when opening. Purchasing keeps packs sealed.
      </small>
    </div>
  );
}
