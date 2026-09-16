"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { StrategyDefinition, StrategyInstance } from "@/lib/strategies/types";

export const STATUS_LABELS: Record<string, string> = {
  DESIGN: "In design",
  READY_FOR_DEMO: "Ready for demo",
  LIVE_DEMO: "Live demo",
  PAUSED: "Paused",
  DEGRADED: "Degraded",
  CLOSED: "Closed",
  PRODUCTION_REVIEW: "Production review",
};

export function StrategyStatusTag({ status }: { status: string }) {
  const tone = status === "LIVE_DEMO" ? "live" : status === "DEGRADED" || status === "PAUSED" ? "warn" : "soon";
  return <span className={`earn-tag earn-tag-${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}

/**
 * The featured strategies. Each row answers the four questions a reader
 * actually has: what goes in, where the return comes from, which protocol
 * does the work, and whether any of this is open to them.
 */
export function FeaturedStrategies({
  definitions,
  instances,
}: {
  definitions: StrategyDefinition[];
  instances: StrategyInstance[];
}) {
  const instanceFor = (id: string) => instances.find((i) => i.definitionId === id) ?? null;
  return (
    <section className="strategy-list" aria-label="Henar strategies">
      {definitions.map((definition) => {
        const instance = instanceFor(definition.id);
        const status = instance?.status ?? definition.status;
        return (
          <Link className="strategy-row" key={definition.id} href={`/earn/strategies/${definition.slug}`}>
            <div className="strategy-row-main">
              <div className="strategy-row-head">
                <h3>{definition.name}</h3>
                <StrategyStatusTag status={status} />
              </div>
              <p>{definition.summary}</p>
              <span className="strategy-row-source">{definition.returnSource}</span>
            </div>
            <dl className="strategy-row-facts">
              <div>
                <dt>Deposit</dt>
                <dd>{definition.deposits}</dd>
              </div>
              <div>
                <dt>Powered by</dt>
                <dd>{definition.protocols.join(" · ")}</dd>
              </div>
              <div>
                <dt>Public deposits</dt>
                <dd className="value-muted">Not available</dd>
              </div>
            </dl>
            <span className="strategy-row-cta">
              View strategy <ArrowRight size={14} />
            </span>
          </Link>
        );
      })}
    </section>
  );
}

/** The standing disclosure. It appears on the index and on every detail page. */
export function StrategyDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <p className={compact ? "strategy-disclosure compact" : "strategy-disclosure"}>
      <strong>Experimental.</strong> These strategies run on Henar&apos;s own capital while their mechanics are validated. They are not audited, they do not accept public deposits, and nothing here is an offer to manage anyone else&apos;s funds.
    </p>
  );
}
