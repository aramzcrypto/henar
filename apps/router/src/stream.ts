/**
 * Provider-neutral account stream (Task 20).
 *
 * A `StreamSource` delivers raw account updates with the slot they landed
 * in, plus connection lifecycle events. Two live implementations are
 * sketched (Solana WebSocket `accountSubscribe`, Yellowstone gRPC) and are
 * LIVE_VALIDATION_PENDING; `FakeStreamSource` drives the worker
 * deterministically in tests.
 */
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

export type AccountUpdate = {
  address: string;
  slot: number;
  account: AccountInfo<Buffer>;
  /** Monotonic sequence within one connection; resets on reconnect. */
  sequence: number;
};

export type StreamEvent =
  | { type: "connected"; at: number }
  | { type: "update"; update: AccountUpdate }
  | { type: "slot"; slot: number }
  | { type: "disconnected"; at: number; reason: string }
  | { type: "error"; at: number; error: string };

export type StreamListener = (event: StreamEvent) => void;

export interface StreamSource {
  readonly name: string;
  subscribe(addresses: string[], listener: StreamListener): Promise<void>;
  unsubscribe(): Promise<void>;
  readonly connected: boolean;
}

/** Deterministic stream for tests: events are pushed by the test. */
export class FakeStreamSource implements StreamSource {
  readonly name = "fake";
  connected = false;
  addresses: string[] = [];
  private listener: StreamListener | null = null;
  private sequence = 0;

  async subscribe(addresses: string[], listener: StreamListener) {
    this.addresses = addresses;
    this.listener = listener;
    this.connected = true;
    this.sequence = 0;
    listener({ type: "connected", at: Date.now() });
  }
  async unsubscribe() {
    this.connected = false;
    this.listener = null;
  }
  push(address: string, slot: number, account: AccountInfo<Buffer>) {
    if (!this.listener || !this.connected) throw new Error("not subscribed");
    this.sequence += 1;
    this.listener({ type: "update", update: { address, slot, account, sequence: this.sequence } });
  }
  slot(slot: number) {
    this.listener?.({ type: "slot", slot });
  }
  disconnect(reason = "test") {
    this.connected = false;
    this.listener?.({ type: "disconnected", at: Date.now(), reason });
  }
  /** Simulate the provider reconnecting; sequence restarts, worker must resync. */
  reconnect() {
    this.connected = true;
    this.sequence = 0;
    this.listener?.({ type: "connected", at: Date.now() });
  }
}

/** Solana WebSocket `accountSubscribe` per address. LIVE_VALIDATION_PENDING. */
export class SolanaWebSocketStream implements StreamSource {
  readonly name = "solana-ws";
  connected = false;
  private ids: number[] = [];
  private slotId: number | null = null;
  private sequence = 0;

  constructor(private readonly connection: Connection, private readonly toKey: (address: string) => PublicKey) {}

  async subscribe(addresses: string[], listener: StreamListener) {
    this.sequence = 0;
    for (const address of addresses) {
      const id = this.connection.onAccountChange(
        this.toKey(address),
        (account, context) => {
          this.sequence += 1;
          listener({ type: "update", update: { address, slot: context.slot, account, sequence: this.sequence } });
        },
        "confirmed",
      );
      this.ids.push(id);
    }
    this.slotId = this.connection.onSlotChange((s) => listener({ type: "slot", slot: s.slot }));
    this.connected = true;
    listener({ type: "connected", at: Date.now() });
  }
  async unsubscribe() {
    await Promise.all(this.ids.map((id) => this.connection.removeAccountChangeListener(id)));
    if (this.slotId !== null) await this.connection.removeSlotChangeListener(this.slotId);
    this.ids = [];
    this.slotId = null;
    this.connected = false;
  }
}

/**
 * Yellowstone gRPC placeholder: the client dependency is not installed and
 * the endpoint needs credentials. Kept as a named seam so the worker's
 * provider choice is explicit. LIVE_VALIDATION_PENDING.
 */
export class YellowstoneStream implements StreamSource {
  readonly name = "yellowstone";
  connected = false;
  async subscribe(): Promise<void> {
    throw new Error("LIVE_VALIDATION_PENDING: Yellowstone gRPC client not configured on this device");
  }
  async unsubscribe() {
    this.connected = false;
  }
}
