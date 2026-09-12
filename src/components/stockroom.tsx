"use client";
import { StockReceipts } from "./stock-receipts";
import { KaniBrand } from "./kani-brand";
import { AppSelect } from "./app-select";
import { TokenLogo } from "@/components/token-logo";
import Link from "next/link";
import Image from "next/image";
import DecimalBase from "decimal.js";
const Decimal = DecimalBase.clone({ precision: 80 });
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  ArrowUpRight,
  Minus,
  Plus,
  ArrowLeftRight,
  Sprout,
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Check,
  ShieldCheck,
  Wallet,
  Box,
  RefreshCw,
  Search,
  X,
  SlidersHorizontal,
  ExternalLink,
  Clock3,
  LockKeyhole,
  Repeat2,
  Zap,
  Crosshair,
  Info,
  Star,
} from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { ProtocolPositions } from "./protocol-inventory";
import { stocks, USDC } from "@/lib/registry";
import { EarnPage, PacksPage, ProductSummary } from "./earn-products";
import { percent, type ProductConfig } from "@/lib/product-config";
import { StockLogo as Logo } from "@/components/stock-logo";
import { utils } from "@coral-xyz/anchor";
import { formatUnits, parseUnits, feeFor } from "@/lib/amount";
import {
  commonPayments,
  PAYMENT_USDC,
  SOL_MINT,
  paymentForMode,
  paymentLabel,
  type PaymentToken,
} from "@/lib/payment-tokens";
import type { MarketReview } from "@/lib/market";
const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  {
    ssr: false,
    loading: () => (
      <button className="wallet-placeholder">Connect wallet</button>
    ),
  },
);
type Balances = Record<
  string,
  { amount: string; decimals: number; uiAmount?: string }
>;
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}
export function Stockroom({
  page,
  config,
}: {
  page: string;
  config: ProductConfig;
}) {
  const protocol = useProtocol();
  config = protocol.data
    ? {
        yieldShareBps: protocol.data.yieldShareBps,
        packFeeBps: protocol.data.packFeeBps,
      }
    : config;
  const wallet = useWallet();
  const { connection } = useConnection();
  const owner = wallet.publicKey?.toBase58();
  const [stock, setStock] = useState(stocks[0]);
  const [mode, setMode] = useState("market");
  useEffect(() => {
    const mint = new URLSearchParams(window.location.search).get("stock");
    const selected = stocks.find((s) => s.mint === mint);
    if (selected) setStock(selected);
  }, []);
  const tradeFeeBps =
    mode === "market" ? 25 : (protocol.data?.tradeFeeBps ?? 25);
  const [amount, setAmount] = useState("100");
  const [marketPayment, setMarketPayment] =
    useState<PaymentToken>(PAYMENT_USDC);
  const [target, setTarget] = useState("");
  const [stockDecimals, setStockDecimals] = useState(9);
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/payment-token?mint=${stock.mint}`, { signal: c.signal })
      .then((r) => r.json())
      .then((t) => {
        if (Number.isInteger(t.decimals)) setStockDecimals(t.decimals);
      })
      .catch(() => {});
    return () => c.abort();
  }, [stock.mint]);
  const funding = paymentForMode(mode, marketPayment);
  const [selling, setSelling] = useState(false);
  const isSelling = mode === "market" && selling;
  const stockToken = {
    mint: stock.mint,
    symbol: stock.ticker,
    name: stock.name,
    decimals: stockDecimals,
    logo: stock.logo,
  };
  const payment = isSelling ? stockToken : funding;
  const receive = isSelling ? funding : stockToken;
  const [receiveAmount, setReceiveAmount] = useState("");
  const [editingOutput, setEditingOutput] = useState(false);
  const [estimate, setEstimate] = useState<{
    input: string;
    output: string;
  } | null>(null);
  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const displayedAmount = editingOutput ? (estimate?.input ?? "") : amount;
  const displayedOutput = editingOutput
    ? receiveAmount
    : (estimate?.output ?? "");
  function editInput(value: string) {
    setEditingOutput(false);
    setEstimate(null);
    setAmount(value);
  }
  useEffect(() => {
    setEstimate(null);
    setEstimateError("");
    const value = editingOutput ? receiveAmount : amount;
    if (!value || !/^\d+(\.\d+)?$/.test(value) || new Decimal(value).lte(0)) {
      setEstimating(false);
      return;
    }
    if (mode === "limit") {
      try {
        const price = new Decimal(target);
        if (price.lte(0)) return;
        setEstimate(
          editingOutput
            ? {
                input: new Decimal(value)
                  .mul(price)
                  .mul(10000)
                  .div(10000 - tradeFeeBps)
                  .toDecimalPlaces(6, Decimal.ROUND_UP)
                  .toFixed(),
                output: value,
              }
            : {
                input: value,
                output: new Decimal(
                  formatUnits(
                    parseUnits(value, 6) -
                      feeFor(parseUnits(value, 6), tradeFeeBps),
                    6,
                  ),
                )
                  .div(price)
                  .toDecimalPlaces(stockDecimals, Decimal.ROUND_DOWN)
                  .toFixed(),
              },
        );
      } catch {}
      return;
    }
    if (mode !== "market") return;
    const controller = new AbortController();
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/market/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputMint: payment.mint,
            outputMint: receive.mint,
            amount: value,
            exactOutput: editingOutput,
          }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setEstimate(data);
      } catch (error) {
        if (!controller.signal.aborted)
          setEstimateError(
            error instanceof Error ? error.message : "Estimate unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setEstimating(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    amount,
    receiveAmount,
    editingOutput,
    payment.mint,
    receive.mint,
    mode,
    target,
    stockDecimals,
    tradeFeeBps,
  ]);
  const [paymentPicker, setPaymentPicker] = useState(false);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [resolvingPayment, setResolvingPayment] = useState(false);
  const paymentLookup = useRef(0);
  function choosePayment(token: PaymentToken) {
    setEditingOutput(false);
    setEstimate(null);
    setReceiveAmount("");
    setMarketPayment(token);
    setAmount("");
    setPaymentPicker(false);
    setPaymentSearch("");
    setPaymentError("");
    paymentLookup.current++;
  }
  async function importPayment() {
    const request = ++paymentLookup.current;
    setResolvingPayment(true);
    setPaymentError("");
    try {
      const res = await fetch(
        `/api/payment-token?mint=${encodeURIComponent(paymentSearch.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (request === paymentLookup.current) choosePayment(data);
    } catch (e) {
      if (request === paymentLookup.current)
        setPaymentError(e instanceof Error ? e.message : "Token unavailable.");
    } finally {
      setResolvingPayment(false);
    }
  }

  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [issuer, setIssuer] = useState("All");
  const [instrument, setInstrument] = useState("All assets");
  const [stockSort, setStockSort] = useState("name");
  const [visibleCount, setVisibleCount] = useState(40);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const resultsRef = useRef<HTMLDivElement>(null);

  const [expiry, setExpiry] = useState(30);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  useEffect(() => {
    setMarketPrice(null);
    if (mode !== "limit") return;
    const c = new AbortController();
    fetch(`/api/market/estimate?mint=${stock.mint}`, { signal: c.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!c.signal.aborted) setMarketPrice(d.price);
      })
      .catch(() => {});
    return () => c.abort();
  }, [mode, stock.mint]);
  const [frequency, setFrequency] = useState("Daily");
  const [installments, setInstallments] = useState("10");
  const [orderTab, setOrderTab] = useState("orders");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [onlySaved, setOnlySaved] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("stockroom:watchlist") || "[]",
      );
      if (Array.isArray(saved))
        setWatchlist(
          saved.filter(
            (m: unknown) =>
              typeof m === "string" && stocks.some((s) => s.mint === m),
          ),
        );
    } catch {}
  }, []);
  function toggleSaved(mint: string) {
    setWatchlist((previous) => {
      const next = previous.includes(mint)
        ? previous.filter((m) => m !== mint)
        : [...previous, mint];
      try {
        localStorage.setItem("stockroom:watchlist", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const filteredStocks = useMemo(
    () =>
      stocks
        .filter(
          (s) =>
            (issuer === "All" || s.provider === issuer) &&
            (instrument === "All assets" || s.instrument === instrument) &&
            (!onlySaved || watchlist.includes(s.mint)) &&
            `${s.name} ${s.ticker} ${s.mint} ${s.underlying}`
              .toLowerCase()
              .includes(deferredSearch),
        )
        .sort(
          (a, b) =>
            (stockSort === "symbol"
              ? a.ticker.localeCompare(b.ticker)
              : a.name.localeCompare(b.name)) ||
            a.provider.localeCompare(b.provider),
        ),
    [issuer, instrument, onlySaved, watchlist, deferredSearch, stockSort],
  );
  useEffect(() => {
    setVisibleCount(40);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [issuer, instrument, onlySaved, deferredSearch, stockSort]);
  let perPurchase = "—";
  try {
    const count = BigInt(installments);
    if (count > 0n)
      perPurchase = formatUnits(parseUnits(displayedAmount, 6) / count, 6);
  } catch {}
  const [balances, setBalances] = useState<Balances | null>(null);
  const [paymentMetadata, setPaymentMetadata] = useState<
    Record<string, Partial<PaymentToken>>
  >({});
  const metadataMints = Object.entries(balances ?? {})
    .filter(
      ([mint, entry]) =>
        BigInt(entry.amount) > 0n &&
        !commonPayments.some((t) => t.mint === mint),
    )
    .map(([mint]) => mint)
    .sort()
    .slice(0, 100)
    .join(",");
  useEffect(() => {
    if (!metadataMints) return;
    const controller = new AbortController();
    fetch(`/api/token-metadata?mints=${encodeURIComponent(metadataMints)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) return;
        const tokens: PaymentToken[] = await r.json();
        if (!controller.signal.aborted)
          setPaymentMetadata(
            Object.fromEntries(tokens.map((t) => [t.mint, t])),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [metadataMints]);
  const availablePayments: PaymentToken[] = [
    ...commonPayments,
    ...Object.entries(balances ?? {})
      .filter(
        ([mint, entry]) =>
          !commonPayments.some((t) => t.mint === mint) &&
          BigInt(entry.amount) > 0n,
      )
      .map(([mint, entry]) => ({
        mint,
        decimals: entry.decimals,
        symbol: paymentMetadata[mint]?.symbol ?? paymentLabel(mint),
        name:
          paymentMetadata[mint]?.name ??
          stocks.find((s) => s.mint === mint)?.ticker ??
          "Wallet token",
        logo:
          paymentMetadata[mint]?.logo ??
          stocks.find((s) => s.mint === mint)?.logo,
      })),
  ];
  const paymentOptions = availablePayments.filter((t) =>
    `${t.symbol} ${t.name} ${t.mint}`
      .toLowerCase()
      .includes(paymentSearch.toLowerCase()),
  );
  const [balanceError, setBalanceError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<MarketReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [signature, setSignature] = useState("");
  const [now, setNow] = useState(0);
  const generation = useRef(0);
  const operation = useRef(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    generation.current++;
    setReview(null);
    setError("");
    setStatus("");
    setSignature("");
  }, [
    owner,
    stock.mint,
    displayedAmount,
    receiveAmount,
    mode,
    payment.mint,
    receive.mint,
  ]);
  useEffect(() => {
    setBalances(null);
    setBalanceError("");
    if (!owner) return;
    const controller = new AbortController();
    fetch(`/api/portfolio?owner=${owner}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBalances(data.balances);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setBalanceError(e.message);
      });
    return () => controller.abort();
  }, [owner, refresh]);
  useEffect(() => {
    if (!review) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review]);
  useEffect(() => {
    if (!picker && !settings && !paymentPicker) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[role=dialog] button:not(:disabled), [role=dialog] input, [role=dialog] select, [role=dialog] a[href]",
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key === "Escape") {
        setPicker(false);
        setSettings(false);
        setPaymentPicker(false);
        paymentLookup.current++;
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [picker, settings, paymentPicker]);
  const payBalance = balances ? (balances[payment.mint]?.amount ?? "0") : null;
  let fee = "—";
  try {
    fee = formatUnits(feeFor(parseUnits(displayedAmount, 6), tradeFeeBps), 6);
  } catch {}
  const expired = review ? now >= review.expiresAt : false;
  async function getQuote() {
    if (!owner || operation.current) return;
    operation.current = true;
    const token = generation.current;
    setBusy(true);
    setError("");
    setReview(null);
    try {
      const res = await fetch("/api/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          mint: receive.mint,
          inputMint: payment.mint,
          mode: "market",
          amount: displayedAmount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (token === generation.current) {
        setReview(data);
        setNow(Date.now());
      }
    } catch (e) {
      if (token === generation.current)
        setError(e instanceof Error ? e.message : "Quote unavailable.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function buy() {
    if (!review || !wallet.signTransaction || !owner || operation.current)
      return;
    operation.current = true;
    setBusy(true);
    setError("");
    const token = generation.current;
    try {
      if (
        review.owner !== owner ||
        review.mint !== receive.mint ||
        review.inputMint !== payment.mint ||
        review.inputDecimals !== payment.decimals ||
        review.amount !==
          parseUnits(displayedAmount, payment.decimals).toString() ||
        Date.now() >= review.expiresAt
      )
        throw new Error("Quote expired. Request a fresh quote.");
      const tx = VersionedTransaction.deserialize(
        Buffer.from(review.transaction, "base64"),
      );
      setStatus("Checking transaction…");
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
      });
      if (sim.value.err)
        throw new Error("Simulation failed. Refresh the quote.");
      if (token !== generation.current || Date.now() >= review.expiresAt)
        throw new Error("Quote changed or expired.");
      setStatus("Confirm in your wallet");
      const signed = await wallet.signTransaction(tx);
      if (token !== generation.current || Date.now() >= review.expiresAt)
        throw new Error(
          "Quote expired before submission. Nothing was submitted.",
        );
      const sig = utils.bytes.bs58.encode(signed.signatures[0]);
      setSignature(sig);
      setReview(null);
      await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });
      setSignature(sig);
      setReview(null);
      setStatus("Submitted · awaiting confirmation");
      const deadline = Date.now() + 60000;
      let confirmed = false;
      while (Date.now() < deadline) {
        const result = await connection.getSignatureStatuses([sig]);
        const value = result.value[0];
        if (value?.err)
          throw new Error("Transaction failed onchain. Inspect it on Solscan.");
        if (
          value?.confirmationStatus === "confirmed" ||
          value?.confirmationStatus === "finalized"
        ) {
          confirmed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      setStatus(
        confirmed
          ? "Purchase confirmed"
          : "Confirmation pending. Check Solscan before retrying.",
      );
      if (confirmed) setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed.");
      setStatus("");
      setReview(null);
    } finally {
      setBusy(false);
      operation.current = false;
    }
  }
  return (
    <div className={`app page-${page}`}>
      <header className="app-header">
        <Link href="/" className="brand" aria-label="Kani Markets home">
          <KaniBrand />
        </Link>
        <nav aria-label="Main navigation">
          {[
            { path: "trade", label: "Trade", icon: ArrowLeftRight },
            { path: "earn", label: "Earn", icon: Sprout },
            { path: "packs", label: "Packs", icon: Box },
            { path: "stockfolio", label: "Stockfolio", icon: Wallet },
          ].map(({ path, label, icon: Icon }) => {
            const active =
              page === path || (page === "portfolio" && path === "stockfolio");
            return (
              <Link
                key={path}
                href={`/${path}`}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="header-right">
          <span className="network">
            <i />
            Solana
          </span>
          <WalletButton />
        </div>
      </header>
      <main>
        {page === "portfolio" && <h1 className="sr-only">Stockfolio</h1>}
        {page === "trade" && (
          <div className="trading-desk">
            <aside className="order-rail" aria-label="Order type">
              <span className="rail-label">Order type</span>
              {[
                { id: "market", name: "Market", icon: Zap },
                { id: "limit", name: "Limit", icon: Crosshair },
                { id: "dca", name: "DCA", icon: Repeat2 },
              ].map(({ id, name, icon: Icon }) => (
                <button
                  key={id}
                  aria-pressed={mode === id}
                  className={mode === id ? "selected" : ""}
                  disabled={busy}
                  onClick={() => {
                    if (paymentForMode(id, marketPayment).mint !== payment.mint)
                      setAmount("");
                    setEditingOutput(false);
                    setEstimate(null);
                    setReceiveAmount("");
                    setMode(id);
                  }}
                >
                  <Icon size={16} />
                  {name}
                  {id === "limit" && <span className="yield-label">Yield</span>}
                  {mode === id && (
                    <ArrowRight className="rail-arrow" size={15} />
                  )}
                </button>
              ))}
            </aside>
            <section
              className={`ticket ticket-${mode}`}
              aria-label={`${mode === "dca" ? "DCA" : mode === "limit" ? "Limit" : "Market"} stock purchase`}
            >
              <div className="ticket-toolbar">
                <h1>
                  {mode === "market"
                    ? isSelling
                      ? "Sell stock"
                      : "Buy stock"
                    : mode === "limit"
                      ? "Buy at your price"
                      : "Build your position"}
                </h1>
                <div>
                  <span className="chain-indicator">
                    <span />
                    Solana
                  </span>
                  <button
                    className="icon-button"
                    onClick={() => setSettings(true)}
                    aria-label="Trade settings"
                  >
                    <SlidersHorizontal size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy || !owner || mode !== "market"}
                    onClick={getQuote}
                    aria-label="Refresh quote"
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
              </div>
              {mode === "limit" && (
                <div className="target-field">
                  <label htmlFor="target">Limit price</label>
                  <div>
                    <input
                      id="target"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    />
                    <span>USDC / {stock.ticker}</span>
                  </div>
                  <div className="limit-market-reference">
                    <span>
                      Market:{" "}
                      {marketPrice === null
                        ? "Unavailable"
                        : marketPrice.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                    </span>
                    <button
                      disabled={marketPrice === null}
                      onClick={() =>
                        marketPrice !== null &&
                        setTarget(
                          new Decimal(marketPrice).toDecimalPlaces(6).toFixed(),
                        )
                      }
                    >
                      Use market
                    </button>
                  </div>
                </div>
              )}
              <div className="ticket-panel pay-panel">
                <label htmlFor="amount">
                  {mode === "dca" ? "Total budget" : "Pay"}
                </label>
                <div className="ticket-amount">
                  <input
                    id="amount"
                    aria-label={`${payment.symbol} amount`}
                    inputMode="decimal"
                    value={displayedAmount}
                    placeholder="0.00"
                    onChange={(e) => editInput(e.target.value)}
                    disabled={busy}
                  />
                  {mode === "market" ? (
                    <button
                      className="token-chip"
                      aria-label="Select payment token"
                      disabled={busy}
                      onClick={() =>
                        isSelling ? setPicker(true) : setPaymentPicker(true)
                      }
                    >
                      <TokenLogo token={payment} />
                      {payment.symbol}
                      <ChevronDown size={15} />
                    </button>
                  ) : (
                    <span
                      className="token-chip"
                      title="Yield orders are funded with USDC"
                    >
                      <TokenLogo token={PAYMENT_USDC} />
                      USDC
                      <LockKeyhole size={12} />
                    </span>
                  )}
                </div>
                <div className="panel-bottom">
                  <div className="quick-amounts">
                    {(payment.mint === SOL_MINT
                      ? ["0.1", "0.5", "1"]
                      : ["50", "100", "500"]
                    ).map((a) => (
                      <button
                        key={a}
                        disabled={busy}
                        onClick={() => editInput(a)}
                      >
                        {payment.mint === USDC ? "$" : ""}
                        {a}
                      </button>
                    ))}
                  </div>
                  <span>
                    Balance:{" "}
                    {payBalance === null
                      ? "—"
                      : formatUnits(payBalance, payment.decimals, 6)}{" "}
                    <button
                      className="max-button"
                      disabled={
                        busy || payBalance === null || payment.mint === SOL_MINT
                      }
                      title={
                        payment.mint === SOL_MINT
                          ? "Leave SOL for transaction fees"
                          : "Use full token balance"
                      }
                      onClick={() =>
                        payBalance !== null &&
                        editInput(formatUnits(payBalance, payment.decimals))
                      }
                    >
                      Max
                    </button>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="direction"
                aria-label="Switch buying and selling"
                disabled={busy || mode !== "market"}
                title={
                  mode === "market" ? "Switch assets" : "Yield orders use USDC"
                }
                onClick={() => {
                  setSelling(!selling);
                  editInput(displayedOutput);
                  setReceiveAmount("");
                }}
              >
                <ArrowDown size={17} />
              </button>
              <div className="ticket-panel receive-panel">
                <div className="panel-label">
                  <span>
                    {mode === "limit" ? "Quantity to buy" : "Receive"}
                  </span>
                  <span className="issuer-label">
                    {isSelling ? funding.name : stock.provider}
                  </span>
                </div>
                <div className="ticket-amount">
                  <input
                    aria-label={`${receive.symbol} receive amount`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={
                      review
                        ? formatUnits(review.outAmount, review.decimals)
                        : displayedOutput
                    }
                    disabled={busy || mode === "dca"}
                    onChange={(e) => {
                      setReview(null);
                      setEditingOutput(true);
                      setEstimate(null);
                      setReceiveAmount(e.target.value);
                    }}
                  />
                  <button
                    className="token-chip"
                    onClick={() =>
                      isSelling ? setPaymentPicker(true) : setPicker(true)
                    }
                    disabled={busy}
                    aria-label="Select stock"
                  >
                    <TokenLogo token={receive} />
                    <strong>{receive.symbol}</strong>
                    <ChevronDown size={15} />
                  </button>
                </div>
                <div className="panel-bottom">
                  <span>{receive.name}</span>
                  <span>
                    {balances
                      ? `Balance: ${balances[receive.mint]?.uiAmount ?? formatUnits(balances[receive.mint]?.amount ?? "0", balances[receive.mint]?.decimals ?? 0, 6)}`
                      : "Balance: —"}
                  </span>
                </div>
              </div>
              {mode === "market" && (
                <div className="estimate-caption" aria-live="polite">
                  {estimating
                    ? "Updating estimate…"
                    : estimateError ||
                      (estimate
                        ? "Estimated · Final amounts shown at review"
                        : "")}
                </div>
              )}
              {mode === "limit" && (
                <div className="advanced-order">
                  <div className="expiry-options">
                    <span>Expiry</span>
                    {[1, 7, 30].map((days) => (
                      <button
                        key={days}
                        aria-pressed={expiry === days}
                        className={expiry === days ? "active" : ""}
                        onClick={() => setExpiry(days)}
                      >
                        {days}D
                      </button>
                    ))}
                  </div>
                  <div className="yield-strip">
                    <span>
                      <Sprout size={16} /> Earn while waiting
                    </span>
                    <span className="limit-apy">
                      <strong>{protocol.data?.apy?.toFixed(2) ?? "—"}%</strong>{" "}
                      Variable APY
                    </span>
                  </div>
                  <div className="limit-yield-details">
                    <Row label="Order value">
                      {(() => {
                        try {
                          return `${formatUnits(parseUnits(displayedAmount, 6), 6)} USDC`;
                        } catch {
                          return "— USDC";
                        }
                      })()}
                    </Row>
                    <Row label="Available">
                      {payBalance === null ? "—" : formatUnits(payBalance, 6)}{" "}
                      USDC
                    </Row>
                  </div>
                </div>
              )}
              {mode === "dca" && (
                <div className="advanced-order">
                  <div className="schedule-fields">
                    <label>
                      Every
                      <AppSelect
                        label="Purchase frequency"
                        value={frequency}
                        onChange={setFrequency}
                        options={[
                          { value: "Hourly", label: "Hour" },
                          { value: "Daily", label: "Day" },
                          { value: "Weekly", label: "Week" },
                          { value: "Monthly", label: "Month" },
                        ]}
                      />
                    </label>
                    <div className="dca-count-row">
                      <label htmlFor="dca-purchases">Over</label>
                      <div className="dca-count-control">
                        <button
                          type="button"
                          aria-label="Fewer purchases"
                          disabled={
                            !Number.isInteger(Number(installments)) ||
                            Number(installments) <= 2
                          }
                          onClick={() =>
                            setInstallments(
                              String(Math.max(2, Number(installments) - 1)),
                            )
                          }
                        >
                          <Minus size={15} />
                        </button>
                        <input
                          id="dca-purchases"
                          aria-label="Number of purchases"
                          type="number"
                          min="2"
                          max="365"
                          value={installments}
                          onChange={(e) => setInstallments(e.target.value)}
                        />
                        <button
                          type="button"
                          aria-label="More purchases"
                          disabled={
                            !Number.isInteger(Number(installments)) ||
                            Number(installments) >= 365
                          }
                          onClick={() =>
                            setInstallments(
                              String(Math.min(365, Number(installments) + 1)),
                            )
                          }
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                      <span>purchases</span>
                    </div>
                  </div>
                  <Row label="Budget per purchase">{perPurchase} USDC</Row>
                </div>
              )}
              <details
                className="fee-disclosure"
                key={review?.transaction ?? "no-quote"}
                open={!!review}
              >
                <summary>
                  <span>
                    <Info size={14} />{" "}
                    {review ? "Quote details" : "Fees & execution"}
                  </span>
                  <span>
                    {percent(tradeFeeBps)} fee <ChevronDown size={14} />
                  </span>
                </summary>
                <div className="trade-details">
                  <Row label={`Protocol fee · ${percent(tradeFeeBps)}`}>
                    {review
                      ? `${formatUnits(review.protocolFee, review.feeDecimals)} ${review.feeMint === stock.mint ? stock.ticker : funding.symbol}`
                      : mode === "market"
                        ? "Available with quote"
                        : `${fee} USDC`}
                  </Row>
                  <Row label="Slippage tolerance">0.50%</Row>
                  <Row label="Price impact">
                    {review ? `${Number(review.priceImpactPct) * 100}%` : "—"}
                  </Row>
                  {review ? (
                    <>
                      <Row label="Minimum received">
                        {formatUnits(review.minimum, review.decimals)}{" "}
                        {receive.symbol}
                      </Row>
                      <Row label="Network fee">
                        {formatUnits(review.networkFee, 9)} SOL
                      </Row>
                      <Row label="Account funding">
                        {formatUnits(review.rent, 9)} SOL
                      </Row>
                      <Row label="Quote expires">
                        {Math.max(
                          0,
                          Math.ceil((review.expiresAt - now) / 1000),
                        )}
                        s
                      </Row>
                    </>
                  ) : (
                    <Row label="Network fee">Available with quote</Row>
                  )}
                  {mode === "limit" && (
                    <>
                      <Row label="Protocol share of earned yield">
                        {percent(config.yieldShareBps)}
                      </Row>
                      <Row label="Cancellation fees">
                        Available before signature
                      </Row>
                      <p className="product-caption">
                        Cancellation returns principal and user yield, less any
                        fees disclosed before signing.
                      </p>
                    </>
                  )}
                </div>
              </details>
              {error && (
                <div role="alert" className="error-message">
                  {error}
                </div>
              )}
              {status && (
                <p role="status" className="status-message">
                  {status}
                </p>
              )}
              {signature && (
                <a
                  className="transaction-link"
                  href={`https://solscan.io/tx/${signature}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ExternalLink size={13} />
                </a>
              )}
              <div className="mobile-action-dock trade-purchase-action">
                {mode !== "market" ? (
                  <button
                    className="primary"
                    disabled={
                      !owner ||
                      !protocol.data ||
                      protocol.data.paused ||
                      protocol.busy ||
                      !protocol.data.stocks.some((s) => s.mint === stock.mint)
                    }
                    onClick={() => {
                      try {
                        protocol.run({
                          action: "deposit",
                          kind: mode,
                          amount: parseUnits(displayedAmount, 6).toString(),
                          stockMint: stock.mint,
                          targetPrice:
                            mode === "limit"
                              ? parseUnits(target, 6).toString()
                              : "0",
                          expiresAt:
                            mode === "limit"
                              ? String(
                                  Math.floor(Date.now() / 1000) +
                                    expiry * 86400,
                                )
                              : undefined,
                          steps: Number(installments),
                          interval:
                            frequency === "Hourly"
                              ? 3600
                              : frequency === "Weekly"
                                ? 604800
                                : frequency === "Monthly"
                                  ? 2592000
                                  : 86400,
                        });
                      } catch (e) {
                        setStatus(
                          e instanceof Error
                            ? e.message
                            : "Check your order amount.",
                        );
                      }
                    }}
                  >
                    {!protocol.data
                      ? "Orders not connected"
                      : !owner
                        ? "Connect wallet to order"
                        : !protocol.data.stocks.some(
                              (s) => s.mint === stock.mint,
                            )
                          ? "Stock not enabled for earning orders"
                          : `Review ${mode} order`}
                  </button>
                ) : !owner ? (
                  <div className="connect-action">
                    <WalletButton>Connect wallet</WalletButton>
                  </div>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || !wallet.signTransaction}
                    onClick={review && !expired ? buy : getQuote}
                  >
                    {busy
                      ? status || "Getting quote…"
                      : !wallet.signTransaction
                        ? "Wallet cannot sign"
                        : review && !expired
                          ? `${isSelling ? "Sell" : "Buy"} ${stock.ticker}`
                          : expired
                            ? "Refresh quote"
                            : isSelling
                              ? "Review sell"
                              : "Review buy"}
                  </button>
                )}
              </div>
              <div className="execution-caption">
                <ShieldCheck size={12} /> Self-custody <span>·</span> Routed by
                Jupiter
              </div>
              <ProtocolPositions />
              <section className="ticket-activity">
                <div className="activity-tabs">
                  <button
                    className={orderTab === "orders" ? "active" : ""}
                    onClick={() => setOrderTab("orders")}
                  >
                    Open orders
                  </button>
                  <button
                    className={orderTab === "history" ? "active" : ""}
                    onClick={() => setOrderTab("history")}
                  >
                    History
                  </button>
                  <span>
                    {owner
                      ? `${owner.slice(0, 4)}…${owner.slice(-4)}`
                      : "Wallet not connected"}
                  </span>
                </div>
                {orderTab === "history" && signature ? (
                  <a
                    className="history-entry"
                    href={`https://solscan.io/tx/${signature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Clock3 size={16} />
                    <span>{status || "Transaction submitted"}</span>
                    <ArrowUpRight size={15} />
                  </a>
                ) : (
                  <div className="activity-empty">
                    {!owner
                      ? "Connect a wallet to view activity."
                      : orderTab === "orders"
                        ? protocol.data
                          ? "No additional active orders."
                          : "Limit and DCA orders are not live yet."
                        : "No transactions in this session."}
                  </div>
                )}
              </section>
            </section>
          </div>
        )}
        {page === "earn" && (
          <EarnPage
            owner={owner}
            config={config}
            connect={<WalletButton>Connect wallet</WalletButton>}
          />
        )}
        {page === "packs" && <PacksPage config={config} owner={owner} />}
        {page === "portfolio" && (
          <>
            <ProductSummary
              balances={owner && !balanceError ? balances : null}
            />
            {!owner ? (
              <div className="portfolio-empty">
                <Wallet size={30} />
                <h2>Connect your wallet</h2>
                <p>Your stocks will appear here.</p>
                <WalletButton />
              </div>
            ) : balanceError ? (
              <div className="notice error-message">
                {balanceError}
                <button
                  className="icon-button"
                  onClick={() => setRefresh((v) => v + 1)}
                  aria-label="Retry balances"
                >
                  <RefreshCw size={17} />
                </button>
              </div>
            ) : balances === null ? (
              <div className="portfolio-empty" role="status">
                Loading onchain balances…
              </div>
            ) : (
              <section className="holdings" id="stock-holdings">
                <div className="section-heading">
                  <h2>Your stocks</h2>
                  <button
                    className="icon-button"
                    onClick={() => setRefresh((v) => v + 1)}
                    aria-label="Refresh balances"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                {stocks.filter(
                  (s) => BigInt(balances[s.mint]?.amount ?? "0") > 0n,
                ).length === 0 ? (
                  <div className="portfolio-empty">
                    <Box size={28} />
                    <h3>No supported stocks in this wallet.</h3>
                    <Link href="/trade">
                      Explore stocks <ArrowRight size={14} />
                    </Link>
                  </div>
                ) : (
                  stocks
                    .filter((s) => BigInt(balances[s.mint]?.amount ?? "0") > 0n)
                    .map((s) => (
                      <div className="holding-row" key={s.mint}>
                        <span className="asset">
                          <Logo stock={s} />
                          <span>
                            <strong>{s.name}</strong>
                            <small>
                              {s.ticker} · {s.category}
                            </small>
                          </span>
                        </span>
                        <strong>
                          {balances[s.mint].uiAmount ??
                            formatUnits(
                              balances[s.mint].amount,
                              balances[s.mint].decimals,
                            )}{" "}
                          units
                        </strong>
                        <a
                          href={`https://solscan.io/account/${owner}?token_address=${s.mint}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ArrowUpRight size={16} />
                        </a>
                      </div>
                    ))
                )}
              </section>
            )}
            <StockReceipts owner={owner} />
          </>
        )}
      </main>
      <footer>
        <span className="footer-network">
          <span /> Solana mainnet
        </span>
        <div>
          <a href={stock.disclosures} target="_blank" rel="noreferrer">
            Disclosures <ArrowUpRight size={12} />
          </a>
          <span>Kani Markets</span>
        </div>
      </footer>
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="picker-title"
            className="modal stock-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="selector-header">
              <Search size={21} />
              <h2 id="picker-title" className="sr-only">
                Select a stock
              </h2>
              <input
                autoFocus
                aria-label="Search stocks"
                placeholder="Search stocks or mint address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="verified-label">
                <ShieldCheck size={15} /> Verified
              </span>
              <button
                className="icon-button"
                aria-label="Close stock selector"
                onClick={() => setPicker(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="issuer-tabs" aria-label="Stock issuer">
              {["All", "xStocks", "Ondo", "Backpack"].map((p) => (
                <button
                  aria-pressed={issuer === p}
                  key={p}
                  className={issuer === p ? "active" : ""}
                  onClick={() => setIssuer(p)}
                >
                  {p !== "All" && (
                    <Image
                      className="issuer-logo"
                      src={`/logos/issuers/${p.toLowerCase()}.${p === "Backpack" ? "png" : "svg"}`}
                      width={20}
                      height={20}
                      alt=""
                      unoptimized
                    />
                  )}
                  {p}
                  <span className="issuer-count">
                    {p === "All"
                      ? stocks.length
                      : stocks.filter((s) => s.provider === p).length}
                  </span>
                </button>
              ))}
              <button
                className={`watchlist-filter ${onlySaved ? "active" : ""}`}
                aria-label="Show watchlist"
                aria-pressed={onlySaved}
                onClick={() => setOnlySaved((v) => !v)}
              >
                <Star size={16} />
              </button>
            </div>
            <div className="catalog-controls">
              <div className="instrument-tabs" aria-label="Asset type">
                {["All assets", "Stock", "ETF"].map((t) => (
                  <button
                    key={t}
                    className={instrument === t ? "active" : ""}
                    aria-pressed={instrument === t}
                    onClick={() => setInstrument(t)}
                  >
                    {t === "Stock" ? "Stocks" : t === "ETF" ? "ETFs" : t}
                  </button>
                ))}
              </div>
              <label className="catalog-sort">
                <span className="sr-only">Sort assets</span>
                <AppSelect
                  label="Sort assets"
                  value={stockSort}
                  onChange={setStockSort}
                  options={[
                    { value: "name", label: "Name A–Z" },
                    { value: "symbol", label: "Symbol A–Z" },
                  ]}
                />
              </label>
            </div>
            <div className="selector-columns">
              <span>
                Asset{" "}
                <span className="result-count">
                  {filteredStocks.length.toLocaleString()}
                </span>
              </span>
              <span>Balance</span>
            </div>
            <div
              className="selector-results"
              ref={resultsRef}
              aria-busy={search.trim().toLowerCase() !== deferredSearch}
            >
              {filteredStocks.slice(0, visibleCount).map((s) => (
                <div
                  className={`selector-row ${s.mint === stock.mint ? "is-selected" : ""}`}
                  key={s.mint}
                >
                  <button
                    className="asset-choice"
                    onClick={() => {
                      setStock(s);
                      setPicker(false);
                      setSearch("");
                    }}
                  >
                    <span className="asset">
                      <Logo stock={s} />
                      <span>
                        <strong title={s.name}>
                          {s.name}
                          {s.instrument === "ETF" && (
                            <span className="instrument-badge">ETF</span>
                          )}
                        </strong>
                        <small>
                          {s.ticker}
                          <span>·</span>
                          {s.provider}
                          <span>·</span>
                          <span className="asset-mint">
                            {s.mint.slice(0, 4)}…{s.mint.slice(-4)}
                          </span>
                        </small>
                      </span>
                    </span>
                    <span className="selector-balance">
                      {balances
                        ? formatUnits(
                            balances[s.mint]?.amount ?? "0",
                            balances[s.mint]?.decimals ?? 0,
                            6,
                          )
                        : "—"}
                      {s.mint === stock.mint && <Check size={13} />}
                    </span>
                  </button>
                  <button
                    className={`save-stock ${watchlist.includes(s.mint) ? "saved" : ""}`}
                    aria-label={`${watchlist.includes(s.mint) ? "Remove" : "Add"} ${s.ticker} ${watchlist.includes(s.mint) ? "from" : "to"} watchlist`}
                    onClick={() => toggleSaved(s.mint)}
                  >
                    <Star size={16} />
                  </button>
                </div>
              ))}
              {filteredStocks.length > visibleCount && (
                <button
                  className="load-stocks"
                  onClick={() => setVisibleCount((v) => v + 40)}
                >
                  Show more{" "}
                  <span>{filteredStocks.length - visibleCount} remaining</span>
                  <ChevronDown size={14} />
                </button>
              )}
              {filteredStocks.length === 0 && (
                <div className="selector-empty">
                  <Search size={25} />
                  <strong>No stocks found</strong>
                  <p>
                    {onlySaved && !search
                      ? "Save stocks with the star to find them here."
                      : "Try another name, symbol or issuer."}
                  </p>
                </div>
              )}
            </div>
            <div className="selector-footer">
              <ShieldCheck size={13} />
              <span>Issuer-verified mints</span>
              <span>Solana</span>
            </div>
          </section>
        </div>
      )}
      {paymentPicker && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setPaymentPicker(false);
            paymentLookup.current++;
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-title"
            className="modal stock-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="selector-header">
              <Search size={20} />
              <h2 id="payment-title" className="sr-only">
                Payment token
              </h2>
              <input
                autoFocus
                aria-label="Search payment tokens"
                placeholder="Search wallet tokens or paste a mint"
                value={paymentSearch}
                onChange={(e) => {
                  setPaymentSearch(e.target.value);
                  setPaymentError("");
                  paymentLookup.current++;
                }}
              />
              <button
                className="icon-button"
                aria-label="Close payment selector"
                onClick={() => {
                  setPaymentPicker(false);
                  paymentLookup.current++;
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="payment-selector-note">
              Pay with any token with an available route.
            </div>
            <div className="selector-results">
              {paymentOptions.map((token) => (
                <div key={token.mint} className="selector-row">
                  <button
                    className="asset-choice"
                    onClick={() => choosePayment(token)}
                  >
                    <span className="asset">
                      <TokenLogo token={token} />
                      <span>
                        <strong>{token.symbol}</strong>
                        <small>
                          {token.name} · {token.mint.slice(0, 4)}…
                          {token.mint.slice(-4)}
                        </small>
                      </span>
                    </span>
                    <span className="selector-balance">
                      {balances
                        ? formatUnits(
                            balances[token.mint]?.amount ?? "0",
                            token.decimals,
                            6,
                          )
                        : "—"}
                    </span>
                  </button>
                </div>
              ))}
              {paymentOptions.length === 0 && (
                <div className="selector-empty">
                  <strong>Use a token mint address</strong>
                  <p>Custom tokens are checked on Solana.</p>
                </div>
              )}
            </div>
            {paymentSearch.trim() && (
              <div className="import-payment">
                <button
                  className="secondary"
                  disabled={resolvingPayment}
                  onClick={importPayment}
                >
                  {resolvingPayment ? "Checking mint…" : "Use mint address"}
                  <ArrowRight size={14} />
                </button>
                {paymentError && (
                  <p role="alert" className="error-message">
                    {paymentError}
                  </p>
                )}
              </div>
            )}
            <div className="selector-footer">
              <span>Market orders</span>
              <span>Solana</span>
            </div>
          </section>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2 id="settings-title">Trade settings</h2>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setSettings(false)}
              >
                <X size={20} />
              </button>
            </div>
            <Row label="Network">Solana mainnet</Row>
            <Row label="Slippage tolerance">0.50% · fixed</Row>
            <Row label="Market protocol fee">0.25%</Row>
            <Row label="Routing">Jupiter</Row>
            <p>
              Network fees and account funding are shown with your executable
              quote.
            </p>
            <a href={stock.disclosures} target="_blank" rel="noreferrer">
              Read asset disclosures <ArrowUpRight size={14} />
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
