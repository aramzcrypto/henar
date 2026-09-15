/**
 * Health, metrics and circuit breakers (Task 22). Fail closed: /ready is
 * false unless the worker is synced, the stream is connected, and no
 * breaker that gates quoting is open.
 */
import type { Venue } from "@henar/router-core";
import type { StateWorker } from "./worker";

export type BreakerState = "closed" | "open" | "half-open";

export type BreakerOptions = {
  /** Consecutive failures that open the breaker. */
  failureThreshold: number;
  /** How long the breaker stays open before a probe is allowed (ms). */
  openMs: number;
  /** Successes in half-open needed to close. */
  successesToClose: number;
};

export const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 5, openMs: 30_000, successesToClose: 2 };

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private successes = 0;
  private openedAt: number | null = null;
  constructor(readonly name: string, private readonly options: BreakerOptions = DEFAULT_BREAKER, private readonly now: () => number = Date.now) {}

  get current(): BreakerState {
    if (this.state === "open" && this.openedAt !== null && this.now() - this.openedAt >= this.options.openMs) this.state = "half-open";
    return this.state;
  }
  /** True when a call may proceed. */
  allow() {
    return this.current !== "open";
  }
  success() {
    if (this.current === "half-open") {
      this.successes += 1;
      if (this.successes >= this.options.successesToClose) this.reset();
    } else this.failures = 0;
  }
  failure() {
    this.successes = 0;
    if (this.current === "half-open") return this.trip();
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) this.trip();
  }
  private trip() {
    this.state = "open";
    this.openedAt = this.now();
    this.failures = 0;
    this.successes = 0;
  }
  reset() {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.openedAt = null;
  }
  snapshot() {
    return { name: this.name, state: this.current, failures: this.failures, openedAt: this.openedAt === null ? null : new Date(this.openedAt).toISOString() };
  }
}

type Histogram = { count: number; sum: number; buckets: Map<number, number> };
const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, Histogram>();

  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const k = key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }
  set(name: string, value: number, labels: Record<string, string> = {}) {
    this.gauges.set(key(name, labels), value);
  }
  observe(name: string, value: number, labels: Record<string, string> = {}) {
    const k = key(name, labels);
    const h = this.histograms.get(k) ?? { count: 0, sum: 0, buckets: new Map(LATENCY_BUCKETS_MS.map((b) => [b, 0])) };
    h.count += 1;
    h.sum += value;
    for (const b of LATENCY_BUCKETS_MS) if (value <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
    this.histograms.set(k, h);
  }
  get(name: string, labels: Record<string, string> = {}) {
    return this.counters.get(key(name, labels)) ?? this.gauges.get(key(name, labels)) ?? 0;
  }
  /** Prometheus text exposition. */
  render() {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.gauges) lines.push(`${k} ${v}`);
    for (const [k, h] of this.histograms) {
      const [name, labels] = split(k);
      for (const [b, c] of h.buckets) lines.push(`${name}_bucket{${labels}${labels ? "," : ""}le="${b}"} ${c}`);
      lines.push(`${name}_bucket{${labels}${labels ? "," : ""}le="+Inf"} ${h.count}`);
      lines.push(`${name}_sum{${labels}} ${h.sum}`);
      lines.push(`${name}_count{${labels}} ${h.count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

function key(name: string, labels: Record<string, string>) {
  const l = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return l ? `${name}{${l}}` : name;
}
function split(k: string): [string, string] {
  const i = k.indexOf("{");
  return i < 0 ? [k, ""] : [k.slice(0, i), k.slice(i + 1, -1)];
}

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  at: string;
  worker: StateWorker["readiness"] | null;
  currentSlot: number | null;
  lastStateUpdateAt: string | null;
  enabledPools: number;
  stalePools: number;
  venues: Record<string, { breaker: BreakerState; quoteFailures: number; quoteSuccesses: number }>;
  breakers: ReturnType<CircuitBreaker["snapshot"]>[];
  executionEnabled: boolean;
};

export class RouterHealth {
  readonly metrics = new Metrics();
  readonly breakers = new Map<string, CircuitBreaker>();
  private stream = { healthy: false, detail: "not started" };
  constructor(private readonly worker: StateWorker | null, private readonly options: { now?: () => number; breaker?: BreakerOptions; executionEnabled?: () => boolean } = {}) {}

  breaker(name: string) {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(name, this.options.breaker ?? DEFAULT_BREAKER, this.options.now ?? Date.now);
      this.breakers.set(name, b);
    }
    return b;
  }

  recordQuote(venue: Venue, ok: boolean, latencyMs: number) {
    this.metrics.inc(ok ? "henar_router_quote_success_total" : "henar_router_quote_failure_total", { venue });
    this.metrics.observe("henar_router_quote_latency_ms", latencyMs, { venue });
    const b = this.breaker(`venue:${venue}`);
    if (ok) b.success();
    else b.failure();
  }
  recordSimulation(ok: boolean) {
    this.metrics.inc(ok ? "henar_router_simulation_success_total" : "henar_router_simulation_failure_total");
    const b = this.breaker("simulation");
    if (ok) b.success();
    else b.failure();
  }
  recordExecution(ok: boolean) {
    this.metrics.inc(ok ? "henar_router_execution_success_total" : "henar_router_execution_failure_total");
  }
  recordStream(healthy: boolean, detail: string) {
    this.stream = { healthy, detail };
    this.metrics.set("henar_router_stream_healthy", healthy ? 1 : 0);
  }

  async report(): Promise<HealthReport> {
    const worker = this.worker?.readiness ?? null;
    const statuses = this.worker ? await this.worker.poolStatuses() : [];
    const stale = statuses.filter((s) => s.stale).length;
    this.metrics.set("henar_router_current_slot", worker?.currentSlot ?? 0);
    this.metrics.set("henar_router_enabled_pools", statuses.length);
    this.metrics.set("henar_router_stale_pools", stale);
    const venues: HealthReport["venues"] = {};
    for (const [name, b] of this.breakers)
      if (name.startsWith("venue:")) {
        const venue = name.slice(6);
        venues[venue] = { breaker: b.current, quoteFailures: this.metrics.get("henar_router_quote_failure_total", { venue }), quoteSuccesses: this.metrics.get("henar_router_quote_success_total", { venue }) };
      }
    const anyOpen = [...this.breakers.values()].some((b) => b.current === "open");
    const status: HealthReport["status"] = !this.worker || !worker?.ready || !this.stream.healthy ? "down" : anyOpen || stale > 0 ? "degraded" : "ok";
    return {
      status,
      at: new Date(this.options.now?.() ?? Date.now()).toISOString(),
      worker,
      currentSlot: worker?.currentSlot ?? null,
      lastStateUpdateAt: worker?.lastUpdateAt ? new Date(worker.lastUpdateAt).toISOString() : null,
      enabledPools: statuses.length,
      stalePools: stale,
      venues,
      breakers: [...this.breakers.values()].map((b) => b.snapshot()),
      executionEnabled: this.options.executionEnabled?.() ?? false,
    };
  }

  /** /ready: only "ok" or "degraded"-with-closed-simulation-breaker may serve quotes; execution additionally needs every breaker closed. */
  async ready(): Promise<{ ready: boolean; reason: string }> {
    const r = await this.report();
    if (r.status === "down") return { ready: false, reason: r.worker?.reason ?? this.stream.detail };
    if (this.breaker("simulation").current === "open") return { ready: false, reason: "simulation breaker open" };
    return { ready: true, reason: r.status };
  }
}
