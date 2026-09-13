"use client";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { compactUsdc, exactDecimal } from "@/lib/protocol/display";
type Point = { timestamp: string; apy: number; tvl: number };
export function EarnHistory({
  vault,
  metric,
  period,
  tvl,
}: {
  vault?: string;
  metric: "APY" | "TVL";
  period: string;
  tvl?: string | null;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setPoints([]);
    if (!vault || metric === "TVL") return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/protocol/history?days=${period.replace("D", "")}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const value = await r.json();
        if (r.ok && !controller.signal.aborted) setPoints(value.points);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [vault, metric, period]);
  if (metric === "TVL")
    return (
      <div className="earn-chart-empty" role="status">
        <ChartNoAxesCombined size={23} strokeWidth={1.3} />
        <span title={tvl ? `${exactDecimal(tvl)} USDC` : undefined}>
          {tvl ? `${compactUsdc(tvl)} USDC` : "Henar TVL unavailable"}
        </span>
        <small>Current Henar principal · onchain</small>
      </div>
    );
  if (points.length < 2)
    return (
      <div className="earn-chart-empty" role="status">
        <ChartNoAxesCombined size={23} strokeWidth={1.3} />
        <span>
          {loading ? "Loading vault history…" : `${metric} history unavailable`}
        </span>
        <small>{period.replace("D", " days")} · Kamino</small>
      </div>
    );
  const values = points.map((p) => (metric === "APY" ? p.apy : p.tvl)),
    min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || Math.max(Math.abs(max) * 0.01, 0.01);
  const times = points.map((p) => Date.parse(p.timestamp)),
    span = times.at(-1)! - times[0];
  const path = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${12 + ((times[i] - times[0]) / span) * 576},${170 - ((v - min) / range) * 145}`,
    )
    .join(" ");
  const label = (v: number) => `${v.toFixed(2)}%`;
  return (
    <figure className="earn-history">
      <div>
        <span>{label(max)}</span>
        <span>Vault APY</span>
      </div>
      <svg
        viewBox="0 0 600 190"
        role="img"
        aria-label={`${metric} history ranges from ${label(min)} to ${label(max)}`}
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption>
        <span>
          {new Date(points[0].timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>
          {label(min)}–{label(max)}
        </span>
        <span>
          {new Date(points.at(-1)!.timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </figcaption>
    </figure>
  );
}
