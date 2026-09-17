import type { StudioMarketConfig } from "@henar/dbc-studio";

/**
 * What you are about to launch, stated while you configure it.
 *
 * The form is the only place Studio said anything, so the consequences of a
 * setting — what the market is paired with, what it costs to trade, when it
 * graduates, whether liquidity is locked — were spread across twenty controls
 * and only assembled in the review step. This says them together, from the
 * same config the form edits, so the page explains itself as it is filled in
 * rather than after.
 *
 * Read-only and derived. It holds no state and cannot disagree with the form.
 */

const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;

function tradeFee(config: StudioMarketConfig) {
  const { startingFeeBps, endingFeeBps } = config.baseFee;
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  return startingFeeBps === endingFeeBps ? pct(startingFeeBps) : `${pct(startingFeeBps)} → ${pct(endingFeeBps)}`;
}

function lockedShare(config: StudioMarketConfig) {
  const d = config.liquidityDistribution;
  const locked = d.partnerPermanentLockedPercentage + d.creatorPermanentLockedPercentage;
  if (locked >= 100) return "Fully locked";
  if (locked <= 0) return "Unlocked";
  return `${locked}% locked`;
}

export function DbcStudioPreview({
  config,
  name,
  symbol,
}: {
  config: StudioMarketConfig | null;
  name: string;
  symbol: string;
}) {
  const rows: [string, string][] = config
    ? [
        ["Paired with", "USDC"],
        ["Trade fee", tradeFee(config)],
        ["Market cap at launch", usd(config.initialMarketCap)],
        ["Graduates at", usd(config.migrationMarketCap)],
        ["Migrates into", "Meteora DAMM v2"],
        ["Liquidity", lockedShare(config)],
      ]
    : [];

  return (
    <aside className="studio-preview" aria-label="Launch summary">
      <div className="studio-preview-mark" aria-hidden="true">
        {(symbol || name || "?").trim().slice(0, 3).toUpperCase() || "?"}
      </div>
      <h3>{name.trim() || "Your market"}</h3>
      <p>{symbol.trim() || "ticker"}</p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
