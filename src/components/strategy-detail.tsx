"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { StrategyDisclosure, StrategyStatusTag } from "./earn-strategies";
import type { ActionCheck, ProposedAction, StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";
import type { MarketCandidate, MarketAdmission } from "@/lib/strategies/markets";

type MarketReport = { candidate: MarketCandidate; admission: MarketAdmission }[];

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function units(raw: string | null | undefined, decimals: number, places = 4) {
  if (raw === null || raw === undefined) return null;
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", { maximumFractionDigits: places });
}
function money(raw: string | null | undefined, decimals = 6) {
  const value = units(raw, decimals, 2);
  return value === null ? "—" : `$${value}`;
}
function price(value: string | null | undefined) {
  if (!value) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 })}` : "—";
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="strategy-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Checks({ checks }: { checks: ActionCheck[] }) {
  if (!checks.length) return null;
  return (
    <ul className="strategy-checks">
      {checks.map((c) => (
        <li key={c.name} className={c.ok ? "ok" : "bad"}>
          <b>{c.name}</b>
          <span>{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** The one-way accumulation ladder, with what has filled so far. */
function Ladder({ instance }: { instance: StrategyInstance }) {
  if (instance.state.kind !== "SMART_ACCUMULATE") return null;
  const state = instance.state;
  if (!state.levels.length)
    return <p className="fin-empty">No reference price is available, so no ladder can be shown.</p>;
  const max = Math.max(...state.levels.map((l) => Number(l.allocated)), 1);
  return (
    <div className="ladder">
      <div className="ladder-reference">
        <span>Reference · {state.referenceSource === "pyth-fair-value" ? "Pyth fair value" : "executable route"}</span>
        <strong>{price(state.referencePrice)}</strong>
      </div>
      {state.currentReference && (
        <div className="ladder-reference current">
          <span>Current pool price</span>
          <strong>{price(state.currentReference)}</strong>
        </div>
      )}
      <div className="ladder-levels">
        {state.levels.map((level) => (
          <div className={`ladder-level ${level.status}`} key={level.index}>
            <span className="ladder-price">{price(level.price)}</span>
            <span className="ladder-bar">
              <i style={{ width: `${Math.max((Number(level.allocated) / max) * 100, 4)}%` }} />
            </span>
            <span className="ladder-alloc">{money(level.allocated)}</span>
            <span className="ladder-status">{level.status === "filled" ? "Filled" : level.status === "partial" ? "Partial" : "Pending"}</span>
          </div>
        ))}
      </div>
      <p className="onchain-method">{state.reversibilityNote}</p>
    </div>
  );
}

/** The active range, with the current price against it. */
function RangeBar({ instance }: { instance: StrategyInstance }) {
  if (instance.state.kind !== "RANGE_YIELD") return null;
  const state = instance.state;
  const lower = Number(state.lowerPrice);
  const upper = Number(state.upperPrice);
  const current = state.currentPrice ? Number(state.currentPrice) : null;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower)
    return <p className="fin-empty">No range is configured yet.</p>;
  const span = upper - lower;
  const pad = span * 0.4;
  const from = lower - pad;
  const to = upper + pad;
  const pct = (value: number) => Math.min(Math.max(((value - from) / (to - from)) * 100, 0), 100);
  return (
    <div className="range-bar">
      <div className="range-track">
        <span className="range-active" style={{ left: `${pct(lower)}%`, width: `${pct(upper) - pct(lower)}%` }} />
        {current !== null && <i className="range-current" style={{ left: `${pct(current)}%` }} />}
        {state.pythFairValue && <i className="range-reference" style={{ left: `${pct(Number(state.pythFairValue))}%` }} />}
      </div>
      <div className="range-labels">
        <span>{price(state.lowerPrice)}</span>
        <span className={state.inRange === false ? "negative" : state.inRange ? "positive" : "value-muted"}>
          {state.inRange === null ? "Range status unknown" : state.inRange ? "In range · earning fees" : "Out of range · not earning fees"}
        </span>
        <span>{price(state.upperPrice)}</span>
      </div>
      <p className="onchain-method">
        Current {price(state.currentPrice)}
        {state.pythFairValue ? ` · Pyth fair value ${price(state.pythFairValue)}` : " · no Pyth reference"} · This is concentrated-liquidity market making, not interest.
      </p>
    </div>
  );
}

function StateSection({ instance }: { instance: StrategyInstance }) {
  const state = instance.state;
  if (state.kind === "EARN_STOCKS")
    return (
      <>
        <Facts
          rows={[
            ["Principal", state.principalDeposited === "0" ? "Not funded" : money(state.principalDeposited)],
            ["Kamino position value", state.currentPrincipalClaim === null ? <span className="value-muted">Unavailable</span> : money(state.currentPrincipalClaim)],
            ["Current Kamino supply rate", state.currentSupplyApy === null ? <span className="value-muted">Unavailable</span> : `${state.currentSupplyApy.toFixed(2)}%`],
            ["Yield accrued", state.grossYieldAccrued === null ? <span className="value-muted">Not measurable without a recorded deposit basis</span> : money(state.grossYieldAccrued)],
            ["Realized yield", money(state.yieldRealized)],
            ["Pending conversion", money(state.yieldPendingConversion)],
            [`${state.targetStockSymbol} accumulated`, state.stockAccumulated === "0" ? "None yet" : (units(state.stockAccumulated, 8) ?? "—")],
            ["Last conversion", state.lastConversionAt ?? "None yet"],
            ["Status", state.conversionBlockedReason ?? "Eligible to convert"],
          ]}
        />
        <p className="onchain-method">
          Principal stays in USDC and is never converted. Only yield that has actually been realized buys stock.
        </p>
      </>
    );

  if (state.kind === "SMART_ACCUMULATE")
    return (
      <>
        <Facts
          rows={[
            ["Capital", money(state.initialUSDC)],
            ["USDC remaining", state.remainingUSDC === null ? <span className="value-muted">Unavailable</span> : money(state.remainingUSDC)],
            ["Stock acquired", state.stockAcquired === null ? <span className="value-muted">None yet</span> : (units(state.stockAcquired, 8) ?? "—")],
            ["Average acquisition price", state.averageAcquisitionPrice ? price(state.averageAcquisitionPrice) : <span className="value-muted">No fills yet</span>],
            ["Levels filled", `${state.levelsFilled} of ${state.levels.length}`],
            ["Fees earned", state.feesEarned ? `${units(state.feesEarned.quote, 6) ?? "0"} USDC` : <span className="value-muted">—</span>],
            ["Distribution", state.distribution === "DEEPER_DIP" ? "Deeper dip · more capital lower" : "Even"],
          ]}
        />
        <Ladder instance={instance} />
      </>
    );

  return (
    <>
      <RangeBar instance={instance} />
      <Facts
        rows={[
          ["Position value", state.positionValueQuote === null ? <span className="value-muted">Unavailable</span> : money(state.positionValueQuote)],
          ["Stock side", state.baseAmount === null ? <span className="value-muted">—</span> : `${units(state.baseAmount, 8) ?? "—"} (${state.baseShare === null ? "—" : `${Math.round(state.baseShare * 100)}%`})`],
          ["USDC side", state.quoteAmount === null ? <span className="value-muted">—</span> : `${units(state.quoteAmount, 6) ?? "—"} (${state.baseShare === null ? "—" : `${Math.round((1 - state.baseShare) * 100)}%`})`],
          ["Fees unclaimed", state.feesUnclaimed ? `${units(state.feesUnclaimed.quote, 6) ?? "0"} USDC` : <span className="value-muted">—</span>],
          ["Fees claimed", `${units(state.feesClaimed.quote, 6) ?? "0"} USDC`],
          ["Fee APR", state.feeApr === null ? <span className="value-muted">Insufficient history</span> : `${state.feeApr.value.toFixed(2)}% over ${state.feeApr.windowHours}h`],
        ]}
      />
    </>
  );
}

export function StrategyDetail({
  definition,
  instance,
  proposals,
  markets,
}: {
  definition: StrategyDefinition;
  instance: StrategyInstance;
  proposals: ProposedAction[];
  markets: MarketReport;
}) {
  const market = markets.find((m) => m.candidate.address === instance.market.address) ?? null;
  return (
    <section className="strategy-detail">
      <header className="strategy-header">
        <div>
          <span className="strategy-eyebrow">
            HENAR STRATEGY · {definition.version.toUpperCase()} <StrategyStatusTag status={instance.status} />
          </span>
          <h1>{instance.name}</h1>
          <p>{definition.summary}</p>
        </div>
        <dl className="strategy-header-facts">
          <div>
            <dt>Deposit</dt>
            <dd>{definition.deposits}</dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd>{definition.protocols.join(" · ")}</dd>
          </div>
          <div>
            <dt>Capital</dt>
            <dd>{instance.deployedCapital ? `${money(instance.deployedCapital)} · Henar` : "Not funded"}</dd>
          </div>
          <div>
            <dt>Public deposits</dt>
            <dd className="value-muted">Not available</dd>
          </div>
        </dl>
      </header>

      <StrategyDisclosure />

      <div className="strategy-grid">
        <article>
          <h2>Position</h2>
          <StateSection instance={instance} />
        </article>

        <article>
          <h2>How it works</h2>
          <p className="preipo-prose">{definition.returnSource}</p>
          <h3>Risks</h3>
          <ul className="strategy-risks">
            {definition.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </article>

        <article>
          <h2>Authority</h2>
          <Facts
            rows={[
              ["Owner", instance.authority.owner === "not deployed" ? <span className="value-muted">Not deployed</span> : short(instance.authority.owner)],
              ["Operator", instance.authority.operator ? short(instance.authority.operator) : <span className="value-muted">None — this protocol has no operator role</span>],
              ["Fee owner", instance.authority.feeOwner ? short(instance.authority.feeOwner) : <span className="value-muted">Fees accrue to the owner</span>],
              ["Operator can withdraw principal", instance.authority.operatorCan.withdrawPrincipalToSelf ? <span className="negative">Yes</span> : <span className="positive">No</span>],
              ["Operator can close the position", instance.authority.operatorCan.closePosition ? <span className="negative">Yes</span> : "No"],
            ]}
          />
          <p className="onchain-method">Verified against {instance.authority.verifiedBy}</p>
          <ul className="strategy-risks">
            {instance.authority.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </article>

        <article>
          <h2>Onchain</h2>
          <Facts
            rows={[
              ["Network", "Solana mainnet"],
              ["Protocol market", <a key="m" href={`https://solscan.io/account/${instance.market.address}`} target="_blank" rel="noreferrer">{short(instance.market.address)} <ExternalLink size={11} /></a>],
              ["Positions", instance.positionAddresses.length ? (
                <span key="p" className="strategy-positions">
                  {instance.positionAddresses.map((address) => (
                    <a key={address} href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer">
                      {short(address)} <ExternalLink size={11} />
                    </a>
                  ))}
                </span>
              ) : <span className="value-muted">No position funded yet</span>],
              ["Created", instance.createdAt ?? <span className="value-muted">—</span>],
              ["State read at slot", instance.lastStateSlot ?? <span className="value-muted">—</span>],
              ["Last update", new Date(instance.lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })],
            ]}
          />
          {market && (
            <>
              <h3>Market admission</h3>
              <ul className="strategy-risks">
                {(market.admission.admitted ? market.admission.reasons : market.admission.failures).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </article>

        <article>
          <h2>Fees</h2>
          <Facts
            rows={[
              ["Deposit fee", "0%"],
              ["Withdrawal fee", "0%"],
              ["Henar performance fee", `${(definition.feeModel.performanceFeeBps / 100).toFixed(2)}% during preview`],
              ["Charged against", definition.feeModel.performanceFeeBasis === "realized-yield" ? "Realized yield only" : "Realized LP fees only"],
              ["Currently charging", definition.feeModel.active ? "Yes" : "No"],
            ]}
          />
          <p className="onchain-method">A performance fee is never assessed against principal or against unrealized gains.</p>
        </article>

        <article>
          <h2>Activity</h2>
          {proposals.length === 0 ? (
            <p className="fin-empty">No action is pending. Nothing has been executed on this strategy.</p>
          ) : (
            <div className="strategy-activity">
              {proposals.map((proposal) => (
                <div className="strategy-activity-row" key={`${proposal.action}-${proposal.proposedAt}`}>
                  <div>
                    <strong>{proposal.action.replace(/_/g, " ").toLowerCase()}</strong>
                    <small>{proposal.reason}</small>
                  </div>
                  <Checks checks={proposal.checks.filter((c) => !c.ok).slice(0, 3)} />
                </div>
              ))}
            </div>
          )}
          <p className="onchain-method">
            Actions are proposed by the strategy runner and require an authorized signer. Nothing executes automatically on mainnet.
          </p>
        </article>
      </div>

      <p className="onchain-method">
        {instance.provenance.map((p) => p.source).join(" · ")} · Audit status: not audited ·{" "}
        <Link href="/earn">Back to Earn</Link>
      </p>
    </section>
  );
}
