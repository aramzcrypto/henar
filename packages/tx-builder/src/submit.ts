/**
 * Protected submission (Task 17) — abstraction only; no transaction leaves
 * this device.
 *
 * A `Submitter` wraps one transport. Kinds:
 *   private  (Jito bundle endpoint, Jupiter protected submit) — the
 *            transaction is expected not to be visible in the public mempool;
 *   public   (plain RPC sendTransaction).
 *
 * `submitWithPolicy` tries private submitters in order. A transaction that
 * has been handed to a private endpoint is NEVER additionally broadcast to a
 * public endpoint unless policy.allowPublicFallback is true AND every private
 * attempt failed before acceptance (an accepted private submission ends the
 * process). It never fans out to multiple public endpoints. Retries stop at
 * the blockhash's lastValidBlockHeight.
 *
 * Transports are injected so tests use fakes; the live transports are
 * LIVE_VALIDATION_PENDING.
 */
import type { VersionedTransaction } from "@solana/web3.js";
import { flagEnabled } from "@henar/router-core";

export type SubmitKind = "private" | "public";

export type SubmitResponse = {
  submitter: string;
  kind: SubmitKind;
  accepted: boolean;
  signature: string | null;
  /** Provider-specific id (bundle id, request id). */
  providerId: string | null;
  /** True when the failure is worth retrying on the same submitter. */
  retryable: boolean;
  error: string | null;
  submittedAt: string;
};

export interface Submitter {
  readonly name: string;
  readonly kind: SubmitKind;
  submit(transaction: VersionedTransaction, options: { lastValidBlockHeight: number }): Promise<SubmitResponse>;
}

export type SubmitPolicy = {
  /** Allow a plain RPC broadcast only if every private submitter failed without accepting. */
  allowPublicFallback: boolean;
  maxAttemptsPerSubmitter: number;
  /** Delay between retries on the same submitter (ms); tests pass 0. */
  retryDelayMs: number;
  /** Block-height oracle; retries stop once the blockhash can no longer land. */
  currentBlockHeight: () => Promise<number>;
};

export type SubmitOutcome = {
  accepted: SubmitResponse | null;
  attempts: SubmitResponse[];
  /** "accepted", "expired", "exhausted", "disabled". */
  status: "accepted" | "expired" | "exhausted" | "disabled";
  detail: string;
};

/** Fixed transport shape so Jito / Jupiter / RPC submitters differ only in encoding. */
export type Transport = (body: unknown) => Promise<{ ok: boolean; status: number; json: unknown }>;

function now() {
  return new Date().toISOString();
}

function serialize(tx: VersionedTransaction) {
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Jito block-engine bundle submit (one-transaction bundle). LIVE_VALIDATION_PENDING. */
export class JitoSubmitter implements Submitter {
  readonly name = "jito";
  readonly kind = "private" as const;
  constructor(private readonly transport: Transport) {}
  async submit(tx: VersionedTransaction, _options: { lastValidBlockHeight: number }): Promise<SubmitResponse> {
    void _options;
    const res = await this.transport({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[serialize(tx)], { encoding: "base64" }] });
    const body = res.json as { result?: string; error?: { message?: string } };
    const accepted = res.ok && typeof body?.result === "string";
    return { submitter: this.name, kind: this.kind, accepted, signature: null, providerId: accepted ? body.result! : null, retryable: !accepted && (res.status === 429 || res.status >= 500), error: accepted ? null : (body?.error?.message ?? `HTTP ${res.status}`), submittedAt: now() };
  }
}

/** Jupiter protected/ultra submit. LIVE_VALIDATION_PENDING. */
export class JupiterProtectedSubmitter implements Submitter {
  readonly name = "jupiter-protected";
  readonly kind = "private" as const;
  constructor(private readonly transport: Transport) {}
  async submit(tx: VersionedTransaction, _options: { lastValidBlockHeight: number }): Promise<SubmitResponse> {
    void _options;
    const res = await this.transport({ signedTransaction: serialize(tx) });
    const body = res.json as { signature?: string; requestId?: string; error?: string };
    const accepted = res.ok && typeof body?.signature === "string";
    return { submitter: this.name, kind: this.kind, accepted, signature: accepted ? body.signature! : null, providerId: body?.requestId ?? null, retryable: !accepted && (res.status === 429 || res.status >= 500), error: accepted ? null : (body?.error ?? `HTTP ${res.status}`), submittedAt: now() };
  }
}

/** Plain RPC sendTransaction; public fallback only. LIVE_VALIDATION_PENDING. */
export class RpcSubmitter implements Submitter {
  readonly name = "rpc";
  readonly kind = "public" as const;
  constructor(private readonly send: (tx: VersionedTransaction) => Promise<string>) {}
  async submit(tx: VersionedTransaction, _options: { lastValidBlockHeight: number }): Promise<SubmitResponse> {
    void _options;
    try {
      const signature = await this.send(tx);
      return { submitter: this.name, kind: this.kind, accepted: true, signature, providerId: null, retryable: false, error: null, submittedAt: now() };
    } catch (error) {
      const message = (error as Error).message;
      return { submitter: this.name, kind: this.kind, accepted: false, signature: null, providerId: null, retryable: /blockhash|timeout|429|rate/i.test(message) && !/expired/i.test(message), error: message, submittedAt: now() };
    }
  }
}

export async function submitWithPolicy(
  transaction: VersionedTransaction,
  submitters: Submitter[],
  lastValidBlockHeight: number,
  policy: SubmitPolicy,
  options: { privateSubmitEnabled?: boolean; executionEnabled?: boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SubmitOutcome> {
  const attempts: SubmitResponse[] = [];
  const executionEnabled = options.executionEnabled ?? flagEnabled("routerExecution");
  if (!executionEnabled) return { accepted: null, attempts, status: "disabled", detail: "HENAR_ROUTER_EXECUTION is off" };
  const privateEnabled = options.privateSubmitEnabled ?? flagEnabled("privateSubmit");
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const privates = submitters.filter((s) => s.kind === "private");
  const publics = submitters.filter((s) => s.kind === "public");
  if (publics.length > 1) throw new Error("policy forbids more than one public endpoint");

  const expired = async () => (await policy.currentBlockHeight()) > lastValidBlockHeight;

  const tryOne = async (s: Submitter): Promise<SubmitResponse | "expired" | null> => {
    for (let i = 0; i < policy.maxAttemptsPerSubmitter; i += 1) {
      if (await expired()) return "expired";
      const r = await s.submit(transaction, { lastValidBlockHeight });
      attempts.push(r);
      if (r.accepted) return r;
      if (!r.retryable) return null;
      if (policy.retryDelayMs > 0) await sleep(policy.retryDelayMs);
    }
    return null;
  };

  if (privateEnabled) {
    for (const s of privates) {
      const r = await tryOne(s);
      if (r === "expired") return { accepted: null, attempts, status: "expired", detail: "blockhash expired before acceptance" };
      if (r) return { accepted: r, attempts, status: "accepted", detail: `accepted by ${s.name}` };
    }
  }
  const anyPrivateAccepted = attempts.some((a) => a.kind === "private" && a.accepted);
  if (!anyPrivateAccepted && policy.allowPublicFallback && publics.length) {
    const r = await tryOne(publics[0]);
    if (r === "expired") return { accepted: null, attempts, status: "expired", detail: "blockhash expired before acceptance" };
    if (r) return { accepted: r, attempts, status: "accepted", detail: `accepted by ${publics[0].name} (public fallback)` };
  }
  return {
    accepted: null,
    attempts,
    status: "exhausted",
    detail: privateEnabled ? (policy.allowPublicFallback ? "every submitter failed" : "private submitters failed; public fallback not allowed by policy") : "HENAR_PRIVATE_SUBMIT is off and no public fallback accepted",
  };
}
