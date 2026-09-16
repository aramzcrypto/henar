/**
 * Pyth Pro streaming adapter.
 *
 * A persistent WebSocket belongs in the always-on router worker, never in a
 * request handler. This module defines the interface both sides share and
 * two implementations: the WebSocket source (for the worker, behind
 * HENAR_PYTH_STREAMING) and a REST fallback that polls `latest_price` on
 * request, which is what a serverless deployment uses today.
 *
 *   Pyth WebSocket → PythStreamSource → PythReferenceStore → Router / Markets
 */
import { fetchLatest, type PythClientOptions } from "./client";
import { PYTH_PRO, type PythChannel } from "./config";
import { normalizeReference } from "./price";
import type { PythReference } from "./types";

export type PythStreamEvent =
  | { type: "connected"; at: number }
  | { type: "reference"; reference: PythReference }
  | { type: "disconnected"; at: number; reason: string }
  | { type: "error"; at: number; error: string };

export interface PythStreamSource {
  subscribe(feeds: { feedId: number; symbol: string; exponent: number }[], onEvent: (event: PythStreamEvent) => void): Promise<void>;
  close(): Promise<void>;
}

/** In-memory latest reference per feed, whichever source fed it. */
export class PythReferenceStore {
  private readonly refs = new Map<number, PythReference>();
  set(reference: PythReference) {
    const current = this.refs.get(reference.feedId);
    // Never let an older feed timestamp overwrite a newer one.
    if (current?.feedUpdateTimestampUs && reference.feedUpdateTimestampUs && BigInt(current.feedUpdateTimestampUs) > BigInt(reference.feedUpdateTimestampUs)) return;
    this.refs.set(reference.feedId, reference);
  }
  get(feedId: number) {
    return this.refs.get(feedId) ?? null;
  }
  list() {
    return [...this.refs.values()];
  }
}

/** REST fallback: one `latest_price` call per `subscribe`, no persistent socket. */
export class PythRestFallbackSource implements PythStreamSource {
  constructor(private readonly options: PythClientOptions & { channel?: PythChannel; now?: () => number } = {}) {}
  async subscribe(feeds: { feedId: number; symbol: string; exponent: number }[], onEvent: (event: PythStreamEvent) => void) {
    const now = this.options.now?.() ?? Date.now();
    const channel = this.options.channel ?? PYTH_PRO.defaultChannel;
    try {
      const { feeds: parsed } = await fetchLatest(feeds.map((f) => f.feedId), channel, this.options);
      const meta = new Map(feeds.map((f) => [f.feedId, f]));
      for (const feed of parsed) {
        const m = meta.get(feed.priceFeedId);
        const ref = m ? normalizeReference(feed, m.symbol, m.exponent, channel, now) : null;
        if (ref) onEvent({ type: "reference", reference: ref });
      }
    } catch (error) {
      onEvent({ type: "error", at: now, error: (error as Error).message });
    }
  }
  async close() {}
}

type WebSocketLike = { send(data: string): void; close(): void; addEventListener(type: string, listener: (event: { data?: unknown; reason?: string; message?: string }) => void): void };

/**
 * WebSocket source over the documented JSON protocol (`subscribe`,
 * `streamUpdated`). Bearer key via the Authorization header, so it is only
 * usable from a process that holds the key — the router worker.
 */
export class PythWebSocketSource implements PythStreamSource {
  private socket: WebSocketLike | null = null;
  constructor(
    private readonly options: {
      apiKey: string;
      channel?: PythChannel;
      urls?: readonly string[];
      now?: () => number;
      connect?: (url: string, headers: Record<string, string>) => WebSocketLike;
    },
  ) {}

  async subscribe(feeds: { feedId: number; symbol: string; exponent: number }[], onEvent: (event: PythStreamEvent) => void) {
    const now = () => this.options.now?.() ?? Date.now();
    const channel = this.options.channel ?? PYTH_PRO.defaultChannel;
    const url = (this.options.urls ?? PYTH_PRO.wsUrls)[0];
    const connect = this.options.connect ?? defaultConnect;
    const socket = connect(url, { authorization: `Bearer ${this.options.apiKey}` });
    this.socket = socket;
    const meta = new Map(feeds.map((f) => [f.feedId, f]));
    socket.addEventListener("open", () => {
      onEvent({ type: "connected", at: now() });
      socket.send(JSON.stringify({ type: "subscribe", subscriptionId: 1, priceFeedIds: feeds.map((f) => f.feedId), properties: PYTH_PRO.properties, formats: [], deliveryFormat: "json", channel, parsed: true, ignoreInvalidFeeds: true }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; parsed?: { priceFeeds?: unknown[] }; error?: string };
        if (message.type === "streamUpdated" && message.parsed?.priceFeeds) {
          for (const raw of message.parsed.priceFeeds) {
            const feed = raw as { priceFeedId?: number };
            const m = typeof feed.priceFeedId === "number" ? meta.get(feed.priceFeedId) : undefined;
            if (!m) continue;
            const ref = normalizeReference(raw as Parameters<typeof normalizeReference>[0], m.symbol, m.exponent, channel, now());
            if (ref) onEvent({ type: "reference", reference: ref });
          }
        } else if (message.type === "error" || message.type === "subscriptionError") {
          onEvent({ type: "error", at: now(), error: message.error ?? "subscription error" });
        }
      } catch (error) {
        onEvent({ type: "error", at: now(), error: (error as Error).message });
      }
    });
    socket.addEventListener("close", (event) => onEvent({ type: "disconnected", at: now(), reason: event.reason ?? "closed" }));
    socket.addEventListener("error", (event) => onEvent({ type: "error", at: now(), error: event.message ?? "socket error" }));
  }

  async close() {
    this.socket?.close();
    this.socket = null;
  }
}

function defaultConnect(url: string, headers: Record<string, string>): WebSocketLike {
  // Node 22 ships a global WebSocket; headers are supported through the
  // options bag of the `ws`-compatible constructor when present.
  const Ctor = (globalThis as { WebSocket?: new (url: string, protocols?: string[] | { headers?: Record<string, string> }) => WebSocketLike }).WebSocket;
  if (!Ctor) throw new Error("WebSocket is not available in this runtime");
  return new Ctor(url, { headers });
}
