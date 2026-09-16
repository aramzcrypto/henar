/**
 * Pyth Pro history (`GET /v1/{channel}/history`), TradingView bar format.
 * Bars are returned as the API gives them: aligned arrays become candles,
 * missing intervals stay missing, and nothing is interpolated.
 */
import { createReadCache } from "@/lib/read-cache";
import { provenance, SOURCES } from "@/lib/provenance";
import { fetchHistory, type PythClientOptions, type PythHistoryPayload } from "./client";
import { PYTH_CACHE, PYTH_PRO, type PythChannel, type PythHistoryResolution } from "./config";
import { availabilityFromError } from "./price";
import type { PythCandle, PythHistoryResult } from "./types";

const MAX_RANGE_SECONDS: Record<string, number> = {
  "1": 3 * 86_400,
  "2": 6 * 86_400,
  "5": 14 * 86_400,
  "15": 30 * 86_400,
  "30": 60 * 86_400,
  "60": 120 * 86_400,
  "120": 240 * 86_400,
  "240": 365 * 86_400,
  "360": 2 * 365 * 86_400,
  "720": 3 * 365 * 86_400,
  D: 5 * 365 * 86_400,
  W: 10 * 365 * 86_400,
  M: 20 * 365 * 86_400,
};

export function isResolution(value: string): value is PythHistoryResolution {
  return (PYTH_PRO.historyResolutions as readonly string[]).includes(value);
}

/** Henar-side bound on a request so one chart cannot ask for years of minute bars. */
export function clampRange(resolution: PythHistoryResolution, from: number, to: number) {
  const max = MAX_RANGE_SECONDS[resolution] ?? 30 * 86_400;
  const end = Math.floor(to);
  const start = Math.max(Math.floor(from), end - max);
  return { from: start, to: end };
}

const text = (v: number | string | null | undefined) => (v === null || v === undefined ? null : typeof v === "number" ? (Number.isFinite(v) ? String(v) : null) : v);

/** Pure: aligned bar arrays → candles. Misaligned rows are dropped, never patched. */
export function candlesFromPayload(payload: PythHistoryPayload): PythCandle[] {
  const t = payload.t ?? [];
  const o = payload.o ?? [];
  const h = payload.h ?? [];
  const l = payload.l ?? [];
  const c = payload.c ?? [];
  const v = payload.v ?? [];
  const n = Math.min(t.length, o.length, h.length, l.length, c.length);
  const out: PythCandle[] = [];
  for (let i = 0; i < n; i++) {
    const open = text(o[i]), high = text(h[i]), low = text(l[i]), close = text(c[i]);
    if (open === null || high === null || low === null || close === null || !Number.isInteger(t[i])) continue;
    out.push({ t: t[i], o: open, h: high, l: low, c: close, v: text(v[i] ?? null) });
  }
  return out;
}

const cache = createReadCache<PythHistoryResult>(PYTH_CACHE.historyMs, 128);

export async function pythHistory(
  params: { symbol: string; resolution: PythHistoryResolution; from: number; to: number; channel?: PythChannel },
  options: PythClientOptions = {},
): Promise<PythHistoryResult> {
  const range = clampRange(params.resolution, params.from, params.to);
  const key = `${params.channel ?? PYTH_PRO.defaultChannel}:${params.symbol}:${params.resolution}:${range.from}:${range.to}`;
  const read = async (): Promise<PythHistoryResult> => {
    const base = { symbol: params.symbol, resolution: params.resolution, from: range.from, to: range.to };
    const prov = provenance({ ...SOURCES.pyth, url: "https://docs.pyth.network/price-feeds/pro/api/history" });
    try {
      const payload = await fetchHistory({ ...params, ...range }, options);
      if (payload.s === "no_data") return { ...base, status: "NO_DATA", candles: [], error: null, provenance: prov };
      if (payload.s !== "ok") return { ...base, status: "UNAVAILABLE", candles: [], error: payload.errmsg ?? `history status ${payload.s}`, provenance: prov };
      return { ...base, status: "AVAILABLE", candles: candlesFromPayload(payload), error: null, provenance: prov };
    } catch (error) {
      return { ...base, status: availabilityFromError(error), candles: [], error: (error as Error).message, provenance: prov };
    }
  };
  const value = await cache(key, read);
  return value.status === "AVAILABLE" || value.status === "NO_DATA" || value.status === "NOT_ENTITLED" ? value : read();
}
