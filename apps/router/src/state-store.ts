/**
 * Hot state store (Task 21). In-process memory for a single worker; the
 * interface is the seam for Redis when several workers must share state.
 * Redis is not introduced now — nothing requires it.
 */
import type { NormalizedPoolState } from "@henar/router-core";

export type StoredPoolState = {
  poolAddress: string;
  venue: string;
  /** Slot of the account update that produced this state. */
  slot: number;
  updatedAt: string;
  state: NormalizedPoolState;
};

export interface StateStore {
  get(poolAddress: string): Promise<StoredPoolState | null>;
  set(entry: StoredPoolState): Promise<void>;
  delete(poolAddress: string): Promise<void>;
  list(): Promise<StoredPoolState[]>;
  /** Highest slot seen across the whole store. */
  currentSlot(): Promise<number | null>;
  setCurrentSlot(slot: number): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  private readonly pools = new Map<string, StoredPoolState>();
  private slot: number | null = null;

  async get(poolAddress: string) {
    return this.pools.get(poolAddress) ?? null;
  }
  async set(entry: StoredPoolState) {
    const existing = this.pools.get(entry.poolAddress);
    // Never let an older update overwrite a newer one (out-of-order delivery).
    if (existing && existing.slot > entry.slot) return;
    this.pools.set(entry.poolAddress, entry);
    if (this.slot === null || entry.slot > this.slot) this.slot = entry.slot;
  }
  async delete(poolAddress: string) {
    this.pools.delete(poolAddress);
  }
  async list() {
    return [...this.pools.values()];
  }
  async currentSlot() {
    return this.slot;
  }
  async setCurrentSlot(slot: number) {
    if (this.slot === null || slot > this.slot) this.slot = slot;
  }
  async clear() {
    this.pools.clear();
    this.slot = null;
  }
}
