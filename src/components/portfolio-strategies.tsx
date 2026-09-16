"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { StrategyStatusTag } from "./earn-strategies";
import type { StrategyInstance } from "@/lib/strategies/types";

function money(raw: string | null, decimals = 6) {
  if (raw === null) return null;
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : null;
}

/**
 * Henar's own strategy demos, shown under their own heading.
 *
 * These positions belong to Henar, not to the connected wallet, so they are
 * never counted in a user's holdings. The wallet sees them the way anyone
 * else does: as a live demonstration it can verify on chain.
 */
export function PortfolioStrategies({ owner }: { owner?: string }) {
  const [instances, setInstances] = useState<StrategyInstance[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/earn/strategies", { signal: controller.signal })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data: { instances?: StrategyInstance[] } | null) => {
        if (data?.instances && !controller.signal.aborted) setInstances(data.instances);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!instances?.length) return null;
  const ownedByWallet = owner ? instances.filter((i) => i.authority.owner === owner) : [];

  return (
    <section className="holdings" id="henar-strategies">
      <div className="section-heading">
        <h2>Henar strategies</h2>
        <small className="holdings-note">
          {ownedByWallet.length
            ? "Positions this wallet owns are marked; the rest are Henar's own demos."
            : "Live demos funded by Henar. These are not your positions."}
        </small>
      </div>
      {instances.map((instance) => {
        const deployed = money(instance.deployedCapital);
        const yours = owner !== undefined && instance.authority.owner === owner;
        return (
          <div className="holding-row" key={instance.id}>
            <span className="asset">
              <span>
                <strong>{instance.name}</strong>
                <small>
                  {instance.market.protocol === "kamino" ? "Kamino" : "Meteora DLMM"} ·{" "}
                  {yours ? "Owned by this wallet" : "Henar demo capital"}
                </small>
              </span>
            </span>
            <strong>
              {deployed ?? "Not funded"}
              <small className="holding-value">
                <StrategyStatusTag status={instance.status} />
              </small>
            </strong>
            <Link href={`/earn/strategies/${instance.definitionId}`} aria-label={`Open ${instance.name}`}>
              <ArrowUpRight size={16} />
            </Link>
          </div>
        );
      })}
    </section>
  );
}
