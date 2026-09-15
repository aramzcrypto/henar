"use client";

/**
 * Henar Router panel (Task 24). Rendered only when
 * NEXT_PUBLIC_HENAR_ROUTER_UI=1; the server routes additionally require
 * HENAR_ROUTER_QUOTES + HENAR_ROUTER_UI, and the trade button additionally
 * requires HENAR_ROUTER_EXECUTION on the server. The production Trade
 * button is untouched; this panel is a separate, explicitly labelled path.
 *
 * Trade flow: signed wallet session → POST /api/router/build (fresh quote,
 * guard, plan, unsigned v0 tx) → client validation against the returned
 * plan → simulation → wallet signature → sendRawTransaction → confirmation
 * poll. Every step can refuse; nothing is signed before validation passes.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { parseUnits, formatUnits } from "@/lib/amount";
import { quoteAuthorization } from "@/lib/wallet-access-client";
import { validateRouterTransaction, type RouterPlanSummary } from "@/lib/router-transaction";

type RouterQuote = {
  quoteId: string;
  issuer: string;
  expectedOutput: string | null;
  netUserOutput: string | null;
  minNetUserOutput: string | null;
  minOutput: string | null;
  effectivePrice: string | null;
  priceImpactBps: number | null;
  route: { venue: string; poolAddress: string | null; percentBps: number }[] | null;
  alternatives: { venue: string; netOutput: string; priceImpactBps: number | null; approved: boolean; reason: string | null }[];
  exclusions: { venue: string; reason: string; detail: string | null }[];
  executionProtection: { mode: string; slippageBps: number | null; checks: { name: string; ok: boolean; detail: string }[] } | null;
  unavailableReason: string | null;
  liveValidation: string;
};

type BuildResponse = { quote: RouterQuote; plan: RouterPlanSummary; transaction: string; lastValidBlockHeight: number; error?: string; reason?: string };

const VENUE_LABEL: Record<string, string> = {
  jupiter: "Jupiter",
  raydium: "Raydium CLMM",
  meteora: "Meteora DLMM",
  "meteora-dbc": "Meteora DBC",
  "meteora-damm-v2": "Meteora DAMM v2",
};

type WalletLike = {
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};

export function RouterComparison({
  mint,
  side,
  amountUi,
  inputDecimals,
  outputDecimals,
  outputSymbol,
  owner,
  wallet,
  connection,
}: {
  mint: string;
  side: "buy" | "sell" | null;
  amountUi: string;
  inputDecimals: number;
  outputDecimals: number;
  outputSymbol: string;
  owner: string | null;
  wallet: WalletLike;
  connection: Connection;
}) {
  const [quote, setQuote] = useState<RouterQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const enabled = process.env.NEXT_PUBLIC_HENAR_ROUTER_UI === "1";

  useEffect(() => {
    if (!enabled || !side) return;
    let amount: bigint;
    try {
      amount = parseUnits(amountUi, inputDecimals);
    } catch {
      return;
    }
    if (amount <= 0n) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/router/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, side, amount: amount.toString() }),
        signal: c.signal,
      })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
          setQuote(body);
          setError(null);
        })
        .catch((e) => {
          if (!c.signal.aborted) {
            setQuote(null);
            setError(e.message);
          }
        });
    }, 400);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [enabled, mint, side, amountUi, inputDecimals]);

  async function trade() {
    if (!owner || !side || !wallet.signTransaction || !wallet.signMessage || busy) return;
    setBusy(true);
    setError(null);
    setSignature(null);
    try {
      const amount = parseUnits(amountUi, inputDecimals);
      const inputMint = side === "buy" ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : mint;
      const outputMint = side === "buy" ? mint : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      setStatus("Requesting router build…");
      const authorization = await quoteAuthorization(owner, wallet.signMessage);
      const res = await fetch("/api/router/build", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mint, side, amount: amount.toString(), owner }),
      });
      const body = (await res.json()) as BuildResponse;
      if (!res.ok) throw new Error(body.error ? `${body.error}${body.reason ? ` (${body.reason})` : ""}` : `HTTP ${res.status}`);
      setQuote(body.quote);
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      setStatus("Checking transaction…");
      const tables = await Promise.all(
        tx.message.addressTableLookups.map(async (lookup) => {
          const result = await connection.getAddressLookupTable(lookup.accountKey);
          if (!result.value) throw new Error("Routing table unavailable. Nothing was signed.");
          return result.value;
        }),
      );
      validateRouterTransaction(tx, body.plan, { owner, inputMint, outputMint, amount }, tables);
      const sim = await connection.simulateTransaction(tx, { sigVerify: false });
      if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}. Nothing was signed.`);
      if (Date.now() >= Date.parse(body.plan.expiresAt)) throw new Error("Quote expired before signing. Nothing was signed.");
      setStatus("Confirm in your wallet");
      const signed = await wallet.signTransaction(tx);
      const sig = utils.bytes.bs58.encode(signed.signatures[0]);
      setSignature(sig);
      setStatus("Submitted · awaiting confirmation");
      await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 2 });
      const deadline = Date.now() + 60_000;
      let confirmed = false;
      while (Date.now() < deadline) {
        const st = await connection.getSignatureStatuses([sig]);
        const v = st.value[0];
        if (v?.err) throw new Error("Transaction failed onchain. Inspect it on Solscan.");
        if (v?.confirmationStatus === "confirmed" || v?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setStatus(confirmed ? `Confirmed via ${VENUE_LABEL[body.plan.legs[0]?.venue] ?? "router"} · min out ${formatUnits(body.plan.totals.minimumNetUserOutput, outputDecimals, 6)} ${outputSymbol}` : "Confirmation pending. Check Solscan before retrying.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Router trade failed.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || !side) return null;
  const best = quote?.route?.[0] ?? null;
  const net = quote?.netUserOutput ? formatUnits(quote.netUserOutput, outputDecimals, 6) : null;
  const floor = quote?.minNetUserOutput ? formatUnits(quote.minNetUserOutput, outputDecimals, 6) : null;
  const mode = quote?.executionProtection?.mode ?? null;
  const canTrade = mode === "execute" && Boolean(owner) && Boolean(wallet.signTransaction) && !busy;
  void PublicKey;

  return (
    <section className="router-compare" aria-label="Henar Router">
      <header>
        <span>Henar Router</span>
        <em>{mode === "execute" ? "direct execution · live validation pending" : "comparison only · live validation pending"}</em>
      </header>
      {error ? (
        <p className="router-compare-empty">{error}</p>
      ) : !quote ? (
        <p className="router-compare-empty">Quoting…</p>
      ) : (
        <>
          <div className="router-compare-main">
            <div>
              <b>{best ? (VENUE_LABEL[best.venue] ?? best.venue) : "No route"}</b>
              <i>{quote.unavailableReason ? quote.unavailableReason : mode === "execute" ? "executable" : mode === "quote-only" ? "quote only" : "refused by guard"}</i>
            </div>
            <div>
              <b>{net ? `${net} ${outputSymbol}` : "—"}</b>
              <i>
                {quote.priceImpactBps !== null ? `${(quote.priceImpactBps / 100).toFixed(2)}% impact` : ""}
                {floor ? ` · min ${floor}` : ""}
                {quote.executionProtection?.slippageBps !== null && quote.executionProtection?.slippageBps !== undefined ? ` (${quote.executionProtection.slippageBps} bps)` : ""}
              </i>
            </div>
          </div>
          {mode === "execute" && (
            <button type="button" className="router-compare-trade" onClick={trade} disabled={!canTrade}>
              {busy ? (status ?? "Working…") : `Trade via Henar Router (${best ? (VENUE_LABEL[best.venue] ?? best.venue) : "router"})`}
            </button>
          )}
          {status && !busy && <p className="router-compare-status">{status}</p>}
          {signature && (
            <a className="router-compare-status" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer">
              View on Solscan
            </a>
          )}
          <button type="button" className="router-compare-toggle" onClick={() => setOpen((v) => !v)}>
            Route details {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {open && (
            <div className="router-compare-details">
              {quote.alternatives.map((a) => (
                <div key={a.venue}>
                  <span>{VENUE_LABEL[a.venue] ?? a.venue}</span>
                  <span>{formatUnits(a.netOutput, outputDecimals, 6)}</span>
                  <span>{a.approved ? "approved" : (a.reason ?? "refused")}</span>
                </div>
              ))}
              {quote.exclusions.map((x) => (
                <div key={x.venue} className="muted">
                  <span>{VENUE_LABEL[x.venue] ?? x.venue}</span>
                  <span>—</span>
                  <span>{x.reason}</span>
                </div>
              ))}
              {quote.executionProtection?.checks.filter((c) => !c.ok).map((c) => (
                <div key={c.name} className="muted">
                  <span>{c.name}</span>
                  <span />
                  <span>{c.detail}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
