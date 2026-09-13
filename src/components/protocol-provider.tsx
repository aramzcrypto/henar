"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { validateProtocolTransaction, type ProtocolIntent } from "@/lib/protocol-transaction";
import { X } from "lucide-react";
import type { PreparedAction, ProtocolView } from "@/lib/protocol/view";
import { awaitConfirmation } from "@/lib/protocol/confirmation";
import { utils } from "@coral-xyz/anchor";
import { formatUnits } from "@/lib/amount";
type RequestAction = {
  action: string;
  account?: string;
  amount?: string;
  count?: string;
  kind?: string;
  destination?: string;
  autoPacks?: boolean;
  stockIndex?: number;
  stockMint?: string;
  targetPrice?: string;
  steps?: number;
  interval?: number;
  expiresAt?: string;
  recipient?: string;
  message?: string;
};
type ProtocolContext = {
  data: ProtocolView | null;
  refresh: (fresh?: boolean) => Promise<void>;
  run: (action: RequestAction) => void;
  busy: boolean;
  error: string;
  loading: boolean;
  loadError: string;
};
const Context = createContext<ProtocolContext>({
  data: null,
  refresh: async () => {},
  run: () => {},
  busy: false,
  error: "",
  loading: true,
  loadError: "",
});
export const useProtocol = () => useContext(Context);
export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet(),
    { connection } = useConnection(),
    owner = wallet.publicKey?.toBase58();
  const [data, setData] = useState<ProtocolView | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState<PreparedAction | null>(null),
    [signature, setSignature] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0),
    activeOwner = useRef(owner);
  const intent = useRef<ProtocolIntent | null>(null);
  activeOwner.current = owner;
  const inFlight = useRef<{
    owner: string | undefined;
    promise: Promise<void>;
  } | null>(null);
  const refresh = useCallback(
    async (fresh = false) => {
      if (inFlight.current && inFlight.current.owner === owner)
        return inFlight.current.promise;
      const task = (async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams();
          if (owner) params.set("owner", owner);
          if (fresh) params.set("fresh", "1");
          const res = await fetch(`/api/protocol?${params}`, {
            signal: AbortSignal.timeout(20000),
          });
          const value = await res.json();
          if (!res.ok || !value.available)
            throw new Error("Connection unavailable");
          if (activeOwner.current === owner) {
            setData(value);
            setLoadError("");
          }
        } catch {
          if (activeOwner.current === owner)
            setLoadError(
              "Live connection interrupted. Retry to refresh your balance.",
            );
        } finally {
          if (activeOwner.current === owner) setLoading(false);
        }
      })();
      inFlight.current = { owner, promise: task };
      try {
        await task;
      } finally {
        if (inFlight.current?.promise === task) inFlight.current = null;
      }
    },
    [owner],
  );
  useEffect(() => {
    generation.current++;
    setPrepared(null);
    setData(null);
    setLoadError("");
    setError("");
    setSignature("");
    setBusy(false);
    const updateVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    updateVisible();
    const timer = setInterval(updateVisible, 15000);
    document.addEventListener("visibilitychange", updateVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", updateVisible);
    };
  }, [refresh]);
  const visible = busy || !!prepared || !!error || !!signature;
  useEffect(() => {
    if (visible) {
      dialog.current?.showModal();
      const prior = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prior;
      };
    }
    dialog.current?.close();
  }, [visible]);
  const run = useCallback(
    async (action: RequestAction) => {
      if (busy) return;
      setError("");
      setSignature("");
      setPrepared(null);
      setBusy(true);
      const current = ++generation.current;
      try {
        if (!owner) throw new Error("Connect your wallet first.");
        const res = await fetch("/api/protocol/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, owner }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        if (current === generation.current) {
          const stockIndex = action.stockMint ? data?.stocks.findIndex(s => s.mint === action.stockMint) : action.stockIndex;
          if (stockIndex === -1) throw new Error("Stock is not in the active catalog. Review again.");
          intent.current = { ...action, stockIndex };
          setPrepared(result);
        }
      } catch (e) {
        if (current === generation.current)
          setError(
            e instanceof Error ? e.message : "Unable to prepare transaction.",
          );
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [owner, busy, data?.stocks],
  );
  async function sign() {
    if (!prepared || !wallet.signTransaction || !owner || busy) return;
    setBusy(true);
    setError("");
    const current = generation.current;
    let sent = "";
    try {
      if ((await connection.getBlockHeight()) > prepared.lastValidBlockHeight)
        throw new Error("This preview expired. Close it and review again.");
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(prepared.transaction, "base64"),
      );
      if (transaction.message.staticAccountKeys[0]?.toBase58() !== owner)
        throw new Error("Wallet changed. Review again.");
      if (!intent.current) throw new Error("Review the action again.");
      const tables = await Promise.all(transaction.message.addressTableLookups.map(async lookup => {
        const table = await connection.getAddressLookupTable(lookup.accountKey);
        if (!table.value) throw new Error("Routing table unavailable. Nothing was signed.");
        return table.value;
      }));
      if (current !== generation.current) return;
      validateProtocolTransaction(transaction, owner, intent.current, tables);
      const signed = await wallet.signTransaction(transaction);
      if (current !== generation.current) return;
      sent = utils.bytes.bs58.encode(signed.signatures[0]);
      if (current === generation.current) {
        setSignature(sent);
        setPrepared(null);
      }
      await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await awaitConfirmation(connection, sent, prepared.lastValidBlockHeight);
      const check = await fetch("/api/protocol/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: sent, owner }),
      });
      const verified = await check.json();
      if (!check.ok || !verified.confirmed)
        throw new Error(
          "Transaction submitted; verification is pending. Check its status before retrying.",
        );
      if (current === generation.current) {
        await refresh(true);
        if (
          ["open", "openLucky", "bankLucky", "rollLucky"].includes(
            String(prepared.review.action),
          )
        ) {
          setSignature("");
          document
            .getElementById("sealed-packs")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    } catch (e) {
      if (current === generation.current)
        setError(
          `${e instanceof Error ? e.message : "Transaction failed."}${sent ? " Check the submitted transaction before retrying." : ""}`,
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    setPrepared(null);
    setError("");
    setSignature("");
  }
  return (
    <Context.Provider
      value={{ data, refresh, run, busy, error, loading, loadError }}
    >
      {children}
      {visible && (
        <dialog
          ref={dialog}
          className="product-dialog"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="product-dialog-head">
            <h2>
              {prepared
                ? "Review transaction"
                : signature
                  ? "Transaction submitted"
                  : busy
                    ? "Preparing transaction"
                    : "Transaction unavailable"}
            </h2>
            <button aria-label="Close" onClick={close} disabled={busy}>
              <X size={20} />
            </button>
          </div>
          {prepared && (
            <>
              {Object.entries(prepared.review)
                .filter(([key]) => key !== "computeUnits" && key !== "action")
                .map(([key, value]) => (
                  <div className="detail-row" key={key}>
                    <span>
                      {key
                        .replace(/([A-Z])/g, " $1")
                        .replace(/ U S D C/g, " USDC")
                        .replace(/ Bps/g, "")}
                    </span>
                    <span>
                      {key.endsWith("USDC")
                        ? `${formatUnits(BigInt(String(value)), 6)} USDC`
                        : key.endsWith("Bps")
                          ? `${Number(value) / 100}%`
                          : key.endsWith("Lamports") && value !== "unavailable"
                            ? `${formatUnits(BigInt(String(value)), 9)} SOL`
                            : String(value)}
                    </span>
                  </div>
                ))}
              <button
                className="primary"
                disabled={busy || !wallet.signTransaction}
                onClick={() => void sign()}
              >
                {busy ? "Waiting for wallet…" : "Confirm in wallet"}
              </button>
            </>
          )}
          {busy && !prepared && <p role="status">Checking the transaction…</p>}
          {error && (
            <p role="alert" className="product-unavailable">
              {error}
            </p>
          )}
          {signature && (
            <a
              className="primary"
              href={`https://solscan.io/tx/${signature}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          )}
        </dialog>
      )}
    </Context.Provider>
  );
}
