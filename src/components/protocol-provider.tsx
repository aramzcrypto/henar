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
  refresh: () => Promise<void>;
  run: (action: RequestAction) => void;
  busy: boolean;
  error: string;
};
const Context = createContext<ProtocolContext>({
  data: null,
  refresh: async () => {},
  run: () => {},
  busy: false,
  error: "",
});
export const useProtocol = () => useContext(Context);
export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet(),
    { connection } = useConnection(),
    owner = wallet.publicKey?.toBase58();
  const [data, setData] = useState<ProtocolView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState<PreparedAction | null>(null),
    [signature, setSignature] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0),
    activeOwner = useRef(owner);
  activeOwner.current = owner;
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/protocol${owner ? `?owner=${owner}` : ""}`,
        { cache: "no-store" },
      );
      const value = await res.json();
      if (activeOwner.current === owner)
        setData(value.available ? value : null);
    } catch {
      if (activeOwner.current === owner) setData(null);
    }
  }, [owner]);
  useEffect(() => {
    generation.current++;
    setPrepared(null);
    setData(null);
    setError("");
    setSignature("");
    setBusy(false);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
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
        if (current === generation.current) setPrepared(result);
      } catch (e) {
        if (current === generation.current)
          setError(
            e instanceof Error ? e.message : "Unable to prepare transaction.",
          );
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [owner, busy],
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
        await refresh();
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
    <Context.Provider value={{ data, refresh, run, busy, error }}>
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
