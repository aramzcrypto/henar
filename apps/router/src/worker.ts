/**
 * Always-on state worker (Task 19).
 *
 * Loads the verified pool registry, subscribes to every enabled pool's
 * account through a `StreamSource`, decodes updates with the venue's
 * `StateReader`, keeps normalized state in a `StateStore`, tracks the
 * current slot, detects stale pools, and only reports ready once every
 * subscribed pool has state at or after the sync slot. On disconnect it
 * marks itself not-ready, resubscribes, and requires a full resync
 * (every pool refreshed) before serving again.
 *
 * The worker never fetches on its own: an `AccountLoader` (RPC live,
 * fixtures in tests) supplies the initial snapshot, the stream supplies
 * deltas. Both are injected.
 */
import type { AccountInfo } from "@solana/web3.js";
import { loadPoolRegistry, type NormalizedPoolState, type PoolRegistry, type StateReader, type VerifiedPool } from "@henar/router-core";
import { MemoryStateStore, type StateStore } from "./state-store";
import type { StreamEvent, StreamSource } from "./stream";

export type AccountLoader = (addresses: string[]) => Promise<{ address: string; slot: number; account: AccountInfo<Buffer> | null }[]>;

export type WorkerOptions = {
  registry?: PoolRegistry;
  store?: StateStore;
  stream: StreamSource;
  load: AccountLoader;
  readers: Partial<Record<VerifiedPool["poolType"], StateReader>>;
  /** A pool whose last update is more than this many slots behind the current slot is stale. */
  staleAfterSlots?: number;
  now?: () => number;
  /** Called on every state change; the health module subscribes here. */
  onEvent?: (event: WorkerEvent) => void;
};

export type WorkerEvent =
  | { type: "sync-start"; pools: number }
  | { type: "sync-complete"; slot: number; pools: number }
  | { type: "update"; poolAddress: string; slot: number }
  | { type: "decode-error"; poolAddress: string; error: string }
  | { type: "stream"; event: StreamEvent }
  | { type: "ready"; ready: boolean; reason: string };

export type PoolStatus = { poolAddress: string; venue: string; slot: number | null; stale: boolean; hasState: boolean };

export class StateWorker {
  readonly store: StateStore;
  private readonly registry: PoolRegistry;
  private readonly pools: VerifiedPool[];
  private readonly byAddress: Map<string, VerifiedPool>;
  private currentSlot: number | null = null;
  private syncSlot: number | null = null;
  private synced = new Set<string>();
  private ready = false;
  private readyReason = "not started";
  private lastUpdateAt: number | null = null;
  private reconnects = 0;
  private decodeErrors = 0;

  constructor(private readonly options: WorkerOptions) {
    this.registry = options.registry ?? loadPoolRegistry();
    this.store = options.store ?? new MemoryStateStore();
    this.pools = this.registry.pools.filter((p) => p.enabled && options.readers[p.poolType]);
    this.byAddress = new Map(this.pools.map((p) => [p.address, p]));
  }

  get isReady() {
    return this.ready;
  }
  get readiness() {
    return { ready: this.ready, reason: this.readyReason, currentSlot: this.currentSlot, syncSlot: this.syncSlot, synced: this.synced.size, pools: this.pools.length, reconnects: this.reconnects, decodeErrors: this.decodeErrors, lastUpdateAt: this.lastUpdateAt };
  }

  async start() {
    await this.options.stream.subscribe(
      this.pools.map((p) => p.address),
      (event) => void this.onStream(event),
    );
    await this.resync();
  }

  async stop() {
    await this.options.stream.unsubscribe();
    this.setReady(false, "stopped");
  }

  private setReady(ready: boolean, reason: string) {
    if (ready !== this.ready || reason !== this.readyReason) this.options.onEvent?.({ type: "ready", ready, reason });
    this.ready = ready;
    this.readyReason = reason;
  }

  /** Full snapshot of every subscribed pool; readiness requires all of them. */
  async resync() {
    this.setReady(false, "resyncing");
    this.synced = new Set();
    this.options.onEvent?.({ type: "sync-start", pools: this.pools.length });
    const rows = await this.options.load(this.pools.map((p) => p.address));
    let maxSlot = 0;
    for (const row of rows) {
      if (!row.account) continue;
      maxSlot = Math.max(maxSlot, row.slot);
      await this.ingest(row.address, row.slot, row.account, "rpc");
    }
    this.syncSlot = maxSlot;
    this.bumpSlot(maxSlot);
    this.evaluateReadiness();
    this.options.onEvent?.({ type: "sync-complete", slot: maxSlot, pools: this.synced.size });
  }

  private bumpSlot(slot: number) {
    if (this.currentSlot === null || slot > this.currentSlot) this.currentSlot = slot;
    void this.store.setCurrentSlot(slot);
  }

  private evaluateReadiness() {
    if (!this.options.stream.connected) return this.setReady(false, "stream disconnected");
    const missing = this.pools.filter((p) => !this.synced.has(p.address));
    if (missing.length) return this.setReady(false, `${missing.length} of ${this.pools.length} pools without state since sync`);
    this.setReady(true, "all pools synced");
  }

  private async ingest(address: string, slot: number, account: AccountInfo<Buffer>, source: "rpc" | "stream") {
    const pool = this.byAddress.get(address);
    if (!pool) return;
    const reader = this.options.readers[pool.poolType];
    if (!reader) return;
    let state: NormalizedPoolState;
    try {
      state = reader.decode(address, account);
      state = { ...state, slot, source, readAt: new Date(this.options.now?.() ?? Date.now()).toISOString() };
    } catch (error) {
      this.decodeErrors += 1;
      this.options.onEvent?.({ type: "decode-error", poolAddress: address, error: (error as Error).message });
      return;
    }
    await this.store.set({ poolAddress: address, venue: pool.venue, slot, updatedAt: state.readAt, state });
    this.synced.add(address);
    this.lastUpdateAt = this.options.now?.() ?? Date.now();
    this.options.onEvent?.({ type: "update", poolAddress: address, slot });
  }

  private async onStream(event: StreamEvent) {
    this.options.onEvent?.({ type: "stream", event });
    switch (event.type) {
      case "update":
        await this.ingest(event.update.address, event.update.slot, event.update.account, "stream");
        this.bumpSlot(event.update.slot);
        this.evaluateReadiness();
        break;
      case "slot":
        this.bumpSlot(event.slot);
        break;
      case "disconnected":
        this.setReady(false, `stream disconnected: ${event.reason}`);
        break;
      case "connected":
        // A (re)connection means deltas may have been missed: full resync.
        if (this.syncSlot !== null) {
          this.reconnects += 1;
          await this.resync();
        }
        break;
      case "error":
        this.setReady(false, `stream error: ${event.error}`);
        break;
    }
  }

  /** Per-pool freshness relative to the current slot. */
  async poolStatuses(): Promise<PoolStatus[]> {
    const staleAfter = this.options.staleAfterSlots ?? 150;
    const stored = new Map((await this.store.list()).map((s) => [s.poolAddress, s]));
    return this.pools.map((p) => {
      const s = stored.get(p.address) ?? null;
      const stale = s === null || (this.currentSlot !== null && this.currentSlot - s.slot > staleAfter);
      return { poolAddress: p.address, venue: p.venue, slot: s?.slot ?? null, stale, hasState: s !== null };
    });
  }

  /** State for the quote engine: null when not ready or stale — fail closed. */
  async stateFor(poolAddress: string) {
    if (!this.ready) return null;
    const s = await this.store.get(poolAddress);
    if (!s) return null;
    const staleAfter = this.options.staleAfterSlots ?? 150;
    if (this.currentSlot !== null && this.currentSlot - s.slot > staleAfter) return null;
    return s;
  }
}
