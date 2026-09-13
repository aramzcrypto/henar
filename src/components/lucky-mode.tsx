"use client";
import { PackRules } from "./pack-rules";
import { LUCKY_OUTCOMES } from "@/lib/lucky";
import { formatUnits } from "@/lib/amount";
export type OpeningMode = "random" | "lucky";
export function LuckyMode({
  mode,
  onChange,
  stake,
  stockCount,
}: {
  mode: OpeningMode;
  onChange: (mode: OpeningMode) => void;
  stake: bigint;
  stockCount: number;
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
          Lucky
        </button>
      </div>
      <div className="pack-mode-caption">
        <span>
          {mode === "random"
            ? "Full allocation after fees"
            : "24% chance of a reduced allocation"}
        </span>
        <PackRules>
          <p>
            Buy sealed packs. Choose Random or Lucky when you unpack. Each pack
            contains one randomly selected stock.
          </p>
          <p>
            {stockCount > 0
              ? `Each of the ${stockCount} eligible stocks has an equal 1 in ${stockCount} selection chance.`
              : "Eligible stocks and selection odds appear when the catalog is available."}{" "}
            Verifiable randomness determines the stock.
          </p>
          {mode === "lucky" ? (
            <>
              <table>
                <caption className="sr-only">
                  Lucky payout probabilities
                </caption>
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
              <p className="pack-rules-return">
                95% theoretical return on the post-fee allocation, per roll.
              </p>
              <p>
                Multipliers apply after the pack fee. The fee is charged once on
                Lucky opening and is non-refundable. Average return is
                theoretical, not guaranteed. Bank the result or roll once more.
                Another roll risks the current allocation and reduces its
                expected value by 5%.
              </p>
              <p>
                Network, randomness and stock execution costs are separate.
                Rollover depends on available reserves. Earned packs use Random
                mode.
              </p>
            </>
          ) : (
            <p>
              Random uses the full stock allocation after the disclosed purchase
              fee. Earned packs use 10 USDC with no additional pack-opening
              protocol fee. Network and execution costs are separate.
            </p>
          )}
        </PackRules>
      </div>

    </div>
  );
}

export function LuckyAllocation({ mode, stake, enabled }: {
  mode: OpeningMode;
  stake: bigint;
  enabled: boolean;
}) {
  return (
    <div className="pack-price-allocation" aria-hidden={mode !== "lucky"}>
      <span>Possible allocation · per pack</span>
      <strong>
        {formatUnits(stake / 4n, 6)}–{formatUnits(stake * 2n, 6)} <small>USDC</small>
      </strong>
      {!enabled && (
        <span title="Sealed packs remain refundable. Availability is checked again when unpacking.">
          Lucky unpacking unavailable
        </span>
      )}
    </div>
  );
}
