"use client";
import { productAvailable } from "@/lib/protocol/access";
import { StockReceipts } from "./stock-receipts";
import { HenarBrand } from "./henar-brand";
import { RewardsMenu } from "./rewards-menu";
import { AppSelect } from "./app-select";
import { TokenLogo } from "@/components/token-logo";
import {
  ExecutionSourceLogo,
  getExecutionSourceBrand,
  HENAR_ROUTE_SOURCE,
} from "@/components/execution-source-logo";
import Link from "next/link";
import Image from "next/image";
import DecimalBase from "decimal.js";
const Decimal = DecimalBase.clone({ precision: 80 });
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
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
  Eye,
  User,
  LogOut,
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
  ChartNoAxesCombined,
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
import { quoteAuthorization } from "@/lib/wallet-access-client";
import { validateMarketTransaction } from "@/lib/market-transaction";
import { buildRouterTrade, prepareRouterTransaction, type RouterBuild } from "@/lib/router-trade";
import { inspectRouteWallet } from "@/lib/wallet-route-state";
import { PublicKey } from "@solana/web3.js";
import { unpackMint } from "@solana/spl-token";
import { MARKET_FEE_BPS } from "@/lib/trade-fee";
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

function HeaderWallet() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!wallet.publicKey) {
    return (
      <button
        className="wallet-adapter-button wallet-adapter-button-trigger header-wallet-connect"
        onClick={() => setVisible(true)}
      >
        <Wallet size={14} />
        {!wallet.publicKey && !wallet.connecting ? "Connect" : "Connecting…"}
      </button>
    );
  }

  const base58 = wallet.publicKey.toBase58();
  const shortened = base58.slice(0, 4) + "…" + base58.slice(-4);
  const walletName = wallet.wallet?.adapter.name ?? "Solana wallet";

  return (
    <div className="wallet-adapter-dropdown header-wallet" ref={dropdownRef}>
      <button
        className="wallet-adapter-button wallet-adapter-button-trigger header-wallet-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="header-wallet-avatar">
          <Wallet size={13} />
          <i />
        </span>
        <span className="header-wallet-address">{shortened}</span>
        <ChevronDown
          className="header-wallet-chevron"
          size={13}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          className="wallet-adapter-dropdown-list wallet-adapter-dropdown-list-active header-wallet-menu"
          role="menu"
        >
          <li className="header-wallet-summary" role="none">
            <span>{walletName}</span>
            <small>
              {base58.slice(0, 8)}…{base58.slice(-6)}
            </small>
          </li>
          <li role="none">
            <Link
              href="/stockfolio"
              className="wallet-adapter-dropdown-list-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <span className="header-wallet-menu-icon">
                <User size={14} />
              </span>
              <span>Stockfolio</span>
              <ArrowRight size={12} />
            </Link>
          </li>
          <li role="none">
            <button
              onClick={() => {
                setOpen(false);
                wallet.disconnect();
              }}
              className="wallet-adapter-dropdown-list-item header-wallet-disconnect"
              role="menuitem"
            >
              <span className="header-wallet-menu-icon">
                <LogOut size={14} />
              </span>
              <span>Disconnect</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
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

function usdEstimate(amount: string, unitPrice: number | null) {
  if (!amount || unitPrice === null || !Number.isFinite(unitPrice)) return null;
  try {
    const value = new Decimal(amount).mul(unitPrice);
    if (!value.isFinite() || value.isNegative()) return null;
    const numeric = value.toNumber();
    if (numeric > 0 && numeric < 0.01)
      return `$${value.toSignificantDigits(3).toFixed()}`;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: numeric < 1 ? 4 : 2,
    }).format(numeric);
  } catch {
    return null;
  }
}

/**
 * Lets anyone inspect a public address without connecting. Holdings are public
 * chain state and /api/portfolio already reads by owner, so this needs no new
 * data path — and nothing it shows is simulated.
 */
function ViewAnyWallet({ onView }: { onView: (address: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
  return (
    <form
      className="view-wallet"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) {
          setError("That does not look like a Solana address.");
          return;
        }
        setError("");
        onView(value.trim());
      }}
    >
      <span>or view any wallet, read only</span>
      <div>
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError("");
          }}
          placeholder="Solana address"
          aria-label="Solana address to view"
          spellCheck={false}
        />
        <button type="submit" disabled={!value.trim()}>
          View
        </button>
      </div>
      {error ? <small role="alert">{error}</small> : null}
    </form>
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
  const connected = wallet.publicKey?.toBase58();
  // Holdings are public chain state, so any address can be inspected without a
  // wallet. Viewing never enables signing: `connected` still gates every action.
  const [viewing, setViewing] = useState("");
  const owner = connected ?? (viewing || undefined);
  const [stock, setStock] = useState(stocks[0]);
  const [mode, setMode] = useState("market");
  useEffect(() => {
    const mint = new URLSearchParams(window.location.search).get("stock");
    const selected = stocks.find((s) => s.mint === mint);
    if (selected) {
      setStock(selected);
      setMarketReceive({
        mint: selected.mint,
        symbol: selected.ticker,
        name: selected.name,
        decimals: 9,
        logo: selected.logo,
        provider: selected.provider,
      });
    }
  }, []);
  const tradeFeeBps =
    mode === "market"
      ? MARKET_FEE_BPS
      : (protocol.data?.tradeFeeBps ?? MARKET_FEE_BPS);
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
  const stockToken = {
    mint: stock.mint,
    symbol: stock.ticker,
    name: stock.name,
    decimals: stockDecimals,
    logo: stock.logo,
    provider: stock.provider,
  };
  const [marketReceive, setMarketReceive] = useState<PaymentToken>(() => ({
    mint: stocks[0].mint,
    symbol: stocks[0].ticker,
    name: stocks[0].name,
    decimals: 9,
    logo: stocks[0].logo,
    provider: stocks[0].provider,
  }));
  useEffect(() => {
    setMarketReceive((current) =>
      current.mint === stock.mint
        ? {
            mint: stock.mint,
            symbol: stock.ticker,
            name: stock.name,
            decimals: stockDecimals,
            logo: stock.logo,
            provider: stock.provider,
          }
        : current,
    );
  }, [stock.mint, stock.name, stock.provider, stock.ticker, stock.logo, stockDecimals]);
  const payment = mode === "market" ? marketPayment : funding;
  const receive = mode === "market" ? marketReceive : stockToken;
  const paymentStock = stocks.find((candidate) => candidate.mint === payment.mint);
  const receiveStock = stocks.find((candidate) => candidate.mint === receive.mint);
  const disclosureStock = receiveStock ?? paymentStock;
  const [receiveAmount, setReceiveAmount] = useState("");
  const [review, setReview] = useState<MarketReview | null>(null);
  const [editingOutput, setEditingOutput] = useState(false);
  const [estimate, setEstimate] = useState<{
    input: string;
    output: string;
    executionSource?: string;
    quoteProvider?: string;
    route?: { venue: string; pool: string | null; percent: number | null }[];
    alternatives?: number;
    candidates?: {
      source: string;
      quoteProvider: string;
      providerFeeBps: number;
      providerFeeAmount: string;
      output: string;
      minimumOutput: string;
      priceImpactPct: string | null;
      route: { venue: string; pool: string | null; percent: number | null }[];
      transactionAvailable: boolean;
    }[];
    quotedAt?: string;
    expiresAt?: string | null;
    feeBps?: number;
  } | null>(null);
  /* The route that was actually selected, not a fixed provider name. This row
     read "Jupiter" regardless of which source won, which is both wrong and the
     reason the product looked like a Jupiter front end. */
  const routingSummary = useMemo(() => {
    if (!estimate) return "Best of every connected source";
    const legs = estimate.route ?? [];
    const source = estimate.executionSource ?? estimate.quoteProvider ?? null;
    if (!legs.length) return source ? getExecutionSourceBrand(source).label : "Best of every connected source";
    const venues = [...new Set(legs.map((leg) => leg.venue).filter(Boolean))];
    const via = venues.length > 1 ? `${venues.length} pools · ${venues.join(" + ")}` : venues[0];
    return source ? `${getExecutionSourceBrand(source).label} · ${via}` : via;
  }, [estimate]);
  /* A route Henar's own optimizer constructed, fetched alongside the
     indicative estimate rather than inside it: the estimate fires as the user
     types, and adding five pool reads to that path would slow every keystroke.
     Only a genuinely distinct construction is kept, which is why a single-leg
     result is discarded rather than shown as a Henar quote duplicating the
     venue it resolved to. */
  const [henarRoute, setHenarRoute] = useState<{
    output: string;
    minimumOutput: string | null;
    priceImpactBps: number | null;
    feeBps: number;
    legs: { venue: string; pool: string | null; percent: number }[];
  } | null>(null);
  /* What the router can actually execute, and for how much. Kept separately
     from the displayed Henar row: the row appears only for a distinct
     construction, while execution follows the best net output among routes
     that can be built, whether that is a split or a single native pool. */
  const [routerExecutable, setRouterExecutable] = useState<{
    netOutput: string;
    legs: number;
    venues: string[];
  } | null>(null);
  /** A built Henar route awaiting confirmation, in place of a market review. */
  const [routerReview, setRouterReview] = useState<RouterBuild | null>(null);
  /* The router quotes one representation against USDC. Anything else is
     outside its scope and executes through the market path. */
  const routerSide: "buy" | "sell" | null =
    payment.mint === PAYMENT_USDC.mint ? "buy" : receive.mint === PAYMENT_USDC.mint ? "sell" : null;
  const routerMint = payment.mint === PAYMENT_USDC.mint ? receive.mint : payment.mint;
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  /* Which builder executes, decided by net user output.
     Only two routes can actually be built: one Henar holds (a single native
     pool or a split), and a Jupiter route through /api/market. Whichever
     returns more to the user is the one the trade button uses. Quote-only
     sources are ranked for information and are never executed. */
  const marketBestOutput = useMemo(() => {
    const jupiter = estimate?.candidates?.find((c) => c.source === "jupiter");
    // /api/market always builds through Jupiter, so that is the comparable.
    return jupiter?.output ?? null;
  }, [estimate]);
  const executeVia: "router" | "market" = useMemo(() => {
    if (!routerExecutable) return "market";
    if (!marketBestOutput) return "router";
    try {
      return new Decimal(routerExecutable.netOutput).gt(new Decimal(marketBestOutput)) ? "router" : "market";
    } catch {
      return "market";
    }
  }, [routerExecutable, marketBestOutput]);


  /* Every source competes on final net user output, Henar's own construction
     included. It earns its place in the ranking rather than sitting above the
     list: if a venue delivers more, that venue is the best quote and says so.
     A Henar row therefore means the optimizer built something no single venue
     offered, and that it won on the number that matters. */
  const rankedCandidates = useMemo(() => {
    const venueQuotes = estimate?.candidates ?? [];
    if (!venueQuotes.length) return [];
    const rows = venueQuotes.map((candidate) => ({
      key: `${candidate.source}-${candidate.quoteProvider}`,
      source: candidate.source,
      output: candidate.output,
      minimumOutput: candidate.minimumOutput,
      priceImpactBps: candidate.priceImpactPct === null ? null : Math.round(Number(candidate.priceImpactPct) * 10_000),
      providerFeeBps: candidate.providerFeeBps,
      legs: candidate.route.map((step) => ({ venue: step.venue, pool: step.pool, percent: step.percent })),
      henar: false,
    }));
    if (henarRoute)
      rows.push({
        key: "henar-router",
        source: HENAR_ROUTE_SOURCE,
        output: henarRoute.output,
        minimumOutput: henarRoute.minimumOutput ?? "0",
        priceImpactBps: henarRoute.priceImpactBps,
        providerFeeBps: 0,
        legs: henarRoute.legs,
        henar: true,
      });
    return rows.sort((a, b) => new Decimal(b.output).comparedTo(new Decimal(a.output)));
  }, [estimate, henarRoute]);


  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const displayedAmount = editingOutput ? (estimate?.input ?? "") : amount;
  const displayedOutput = editingOutput
    ? receiveAmount
    : (estimate?.output ?? "");
  const [receiveUsdPrice, setReceiveUsdPrice] = useState<number | null>(null);
  useEffect(() => {
    setReceiveUsdPrice(null);
    if (mode !== "market") return;
    if (receive.mint === USDC) {
      setReceiveUsdPrice(1);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/market/estimate?mint=${encodeURIComponent(receive.mint)}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data) => {
        if (
          !controller.signal.aborted &&
          typeof data.price === "number" &&
          Number.isFinite(data.price) &&
          data.price > 0
        )
          setReceiveUsdPrice(data.price);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [mode, receive.mint]);
  const displayedOutputValue = review
    ? formatUnits(review.outAmount, review.decimals)
    : displayedOutput;
  const outputUnitPrice =
    mode === "limit" && /^\d+(\.\d+)?$/.test(target)
      ? Number(target)
      : receiveUsdPrice;
  const displayedOutputUsd = usdEstimate(displayedOutputValue, outputUnitPrice);
  function editInput(value: string) {
    setEditingOutput(false);
    setEstimate(null);
    setRouterReview(null);
    setAmount(value);
  }
  useEffect(() => {
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
      /* Ask Henar's own optimizer in parallel. It is a separate request on
         purpose: a failure or a slow answer must never hold up or break the
         venue comparison the user is watching. */
      if (routerSide && !editingOutput) {
        void (async () => {
          try {
            const raw = parseUnits(value, payment.decimals);
            if (raw <= 0n) return;
            const response = await fetch("/api/router/quote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mint: routerMint, side: routerSide, amount: raw.toString() }),
              signal: controller.signal,
            });
            if (!response.ok) throw new Error("router unavailable");
            const quote = await response.json();
            if (controller.signal.aborted) return;
            /* Only a construction the optimizer actually built. When it
               resolves to one venue the server sends nothing here, because
               that venue is already in the list and showing the same
               execution twice under two names flatters us and misleads. */
            /* Executable when the guard approved a route Henar can build.
               Jupiter is ranked too, but it is built through /api/market, so
               it is not what this field is about. */
            const mode = quote.executionProtection?.mode ?? null;
            const legs: { venue: string; poolAddress: string | null; percentBps: number }[] = quote.route ?? [];
            setRouterExecutable(
              mode === "execute" && quote.netUserOutput && legs.length
                ? {
                    netOutput: formatUnits(BigInt(quote.netUserOutput), receive.decimals),
                    legs: legs.length,
                    venues: [...new Set(legs.map((leg) => leg.venue))],
                  }
                : null,
            );
            const built = quote.henarRoute;
            if (!built || built.legs.length < 2 || !built.executable) {
              setHenarRoute(null);
              return;
            }
            setHenarRoute({
              output: formatUnits(BigInt(built.netOutput), receive.decimals),
              minimumOutput: built.minNetUserOutput ? formatUnits(BigInt(built.minNetUserOutput), receive.decimals) : null,
              priceImpactBps: built.priceImpactBps ?? null,
              feeBps: quote.fees?.henarBps ?? tradeFeeBps,
              legs: built.legs.map((leg: { venue: string; poolAddress: string | null; percentBps: number }) => ({ venue: leg.venue, pool: leg.poolAddress, percent: leg.percentBps / 100 })),
            });
          } catch {
            if (!controller.signal.aborted) {
              setHenarRoute(null);
              setRouterExecutable(null);
            }
          }
        })();
      } else {
        setHenarRoute(null);
        setRouterExecutable(null);
      }
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
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            // Keep the last good estimate while a provider briefly recovers.
            // The signed review below always requests fresh execution terms.
            return;
          }
          throw new Error(data.error);
        }
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
    quoteRefresh,
    payment.decimals,
    receive.decimals,
    routerMint,
    routerSide,
  ]);
  const [paymentPicker, setPaymentPicker] = useState(false);
  const [assetPickerSide, setAssetPickerSide] = useState<"input" | "output">(
    "input",
  );
  const [assetClass, setAssetClass] = useState<"all" | "crypto" | "stocks">(
    "all",
  );
  const [assetIssuer, setAssetIssuer] = useState<
    "all" | "xStocks" | "Backpack" | "Ondo"
  >("all");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [resolvingPayment, setResolvingPayment] = useState(false);
  const paymentLookup = useRef(0);
  function openAssetPicker(side: "input" | "output") {
    setAssetPickerSide(side);
    setPaymentSearch("");
    setPaymentError("");
    setPaymentPicker(true);
  }
  async function choosePayment(candidate: PaymentToken) {
    let token = candidate;
    if (candidate.decimals < 0) {
      setResolvingPayment(true);
      try {
        const response = await fetch(
          `/api/payment-token?mint=${encodeURIComponent(candidate.mint)}`,
        );
        const verified = await response.json();
        if (!response.ok) throw new Error(verified.error);
        token = { ...candidate, decimals: verified.decimals };
      } catch (error) {
        setPaymentError(
          error instanceof Error ? error.message : "Asset unavailable.",
        );
        return;
      } finally {
        setResolvingPayment(false);
      }
    }
    setEditingOutput(false);
    setEstimate(null);
    setReceiveAmount("");
    if (assetPickerSide === "input") {
      if (token.mint === marketReceive.mint) setMarketReceive(marketPayment);
      setMarketPayment(token);
    } else {
      if (token.mint === marketPayment.mint) setMarketPayment(marketReceive);
      setMarketReceive(token);
    }
    const selectedStock = stocks.find((entry) => entry.mint === token.mint);
    if (selectedStock) setStock(selectedStock);
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
      if (request === paymentLookup.current) await choosePayment(data);
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
  const verifiedStockAssets: PaymentToken[] = stocks.map((entry) => ({
    mint: entry.mint,
    symbol: entry.ticker,
    name: entry.name,
    decimals:
      balances?.[entry.mint]?.decimals ??
      (entry.mint === stock.mint ? stockDecimals : -1),
    logo: entry.logo,
    provider: entry.provider,
  }));
  const walletAssets: PaymentToken[] = Object.entries(balances ?? {})
    .filter(
      ([mint, entry]) =>
        !commonPayments.some((token) => token.mint === mint) &&
        !stocks.some((entry) => entry.mint === mint) &&
        BigInt(entry.amount) > 0n,
    )
    .map(([mint, entry]) => ({
      mint,
      decimals: entry.decimals,
      symbol: paymentMetadata[mint]?.symbol ?? paymentLabel(mint),
      name: paymentMetadata[mint]?.name ?? "Wallet token",
      logo: paymentMetadata[mint]?.logo,
    }));
  const availablePayments: PaymentToken[] = [
    ...commonPayments,
    ...walletAssets,
    ...verifiedStockAssets,
  ];
  const oppositeMint =
    assetPickerSide === "input" ? marketReceive.mint : marketPayment.mint;
  const searchedPaymentOptions = availablePayments
    .filter((token) => {
      const isStock = !!token.provider;
      return (
        token.mint !== oppositeMint &&
        (assetClass === "all" ||
          (assetClass === "stocks" ? isStock : !isStock)) &&
        `${token.symbol} ${token.name} ${token.provider ?? ""} ${token.mint}`
          .toLowerCase()
          .includes(paymentSearch.toLowerCase())
      );
    });
  const paymentOptions = searchedPaymentOptions
    .filter(
      (token) => assetIssuer === "all" || token.provider === assetIssuer,
    )
    .sort((a, b) => {
      const aHeld = BigInt(balances?.[a.mint]?.amount ?? "0") > 0n ? 1 : 0;
      const bHeld = BigInt(balances?.[b.mint]?.amount ?? "0") > 0n ? 1 : 0;
      return bHeld - aHeld || a.name.localeCompare(b.name);
    });
  const heldPaymentOptions = paymentOptions.filter(
    (token) => BigInt(balances?.[token.mint]?.amount ?? "0") > 0n,
  );
  const catalogPaymentOptions = paymentOptions
    .filter((token) => BigInt(balances?.[token.mint]?.amount ?? "0") === 0n)
    .slice(0, 80);
  const [balanceError, setBalanceError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const transactionTone =
    status === "Purchase confirmed"
      ? "confirmed"
      : status === "Confirm in your wallet" ||
          status.includes("awaiting confirmation") ||
          status.startsWith("Confirmation pending")
        ? "pending"
        : "neutral";
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
    if (mode !== "market" || review) return;
    const refreshQuote = () => {
      if (!document.hidden && !operation.current) setQuoteRefresh((n) => n + 1);
    };
    const timer = window.setInterval(refreshQuote, 12_000);
    document.addEventListener("visibilitychange", refreshQuote);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshQuote);
    };
  }, [mode, review, payment.mint, receive.mint]);
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
  /* A built route awaiting confirmation, whichever builder produced it. */
  const routerExpired = routerReview ? now >= Date.parse(routerReview.plan.expiresAt) : false;
  const expired = review ? now >= review.expiresAt : routerExpired;
  const built = Boolean(review) || Boolean(routerReview);
  async function getQuote() {
    if (!owner || operation.current) return;
    operation.current = true;
    const token = generation.current;
    setBusy(true);
    setError("");
    setReview(null);
    setRouterReview(null);
    try {
      const authorization = await quoteAuthorization(owner, wallet.signMessage);
      if (token !== generation.current) return;
      /* The route with the best net output is the route that gets built. */
      if (executeVia === "router" && routerSide) {
        const build = await buildRouterTrade({
          mint: routerMint,
          side: routerSide,
          amount: parseUnits(displayedAmount, payment.decimals),
          owner,
          authorization,
        });
        if (token === generation.current) {
          setRouterReview(build);
          setReview(null);
          setNow(Date.now());
        }
        return;
      }
      setRouterReview(null);
      const res = await fetch("/api/market", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
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
    if ((!review && !routerReview) || !wallet.signTransaction || !owner || operation.current)
      return;
    operation.current = true;
    setBusy(true);
    setError("");
    const token = generation.current;
    try {
      /* A Henar route is validated against its own plan by the router
         transaction validator, which checks the fee, the per-leg floors and
         that nothing but the user signs. Submission and confirmation are
         shared with the market path below. */
      if (routerReview) {
        setStatus("Checking transaction…");
        const routerTx = await prepareRouterTransaction(
          routerReview,
          {
            owner,
            inputMint: payment.mint,
            outputMint: receive.mint,
            amount: parseUnits(displayedAmount, payment.decimals),
          },
          connection,
        );
        if (token !== generation.current) throw new Error("Quote changed. Nothing was signed.");
        setStatus("Confirm in your wallet");
        const signedRouterTx = await wallet.signTransaction(routerTx);
        const routerSig = utils.bytes.bs58.encode(signedRouterTx.signatures[0]);
        setSignature(routerSig);
        setRouterReview(null);
        await connection.sendRawTransaction(signedRouterTx.serialize(), { skipPreflight: false, maxRetries: 2 });
        setStatus("Submitted · awaiting confirmation");
        const routerDeadline = Date.now() + 60_000;
        while (Date.now() < routerDeadline) {
          const result = await connection.getSignatureStatuses([routerSig]);
          const value = result.value[0];
          if (value?.err) throw new Error("Transaction failed onchain. Inspect it on Solscan.");
          if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
            setStatus("Confirmed");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        setStatus("Confirmation pending. Check Solscan before retrying.");
        return;
      }
      if (!review) throw new Error("Request a fresh quote.");
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
      const tables = await Promise.all(
        tx.message.addressTableLookups.map(async (lookup) => {
          const result = await connection.getAddressLookupTable(
            lookup.accountKey,
          );
          if (!result.value)
            throw new Error("Routing table unavailable. Nothing was signed.");
          return result.value;
        }),
      );
      const checked = validateMarketTransaction(
        tx,
        review,
        {
          owner,
          inputMint: payment.mint,
          outputMint: receive.mint,
          inputDecimals: payment.decimals,
          outputDecimals: receive.decimals,
          amount: parseUnits(displayedAmount, payment.decimals),
        },
        tables,
      );
      const mints = await connection.getMultipleAccountsInfo([
        new PublicKey(payment.mint),
        new PublicKey(receive.mint),
      ]);
      for (const [i, mintAddress, tokenProgram, decimals] of [
        [0, payment.mint, review.inputProgram, payment.decimals],
        [1, receive.mint, review.outputProgram, receive.decimals],
      ] as const) {
        const info = mints[i];
        if (
          !info ||
          info.owner.toBase58() !== tokenProgram ||
          unpackMint(new PublicKey(mintAddress), info, info.owner).decimals !==
            decimals
        )
          throw new Error("Token details changed. Nothing was signed.");
      }
      await inspectRouteWallet(connection, checked.instructions, checked.terms);
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
        <Link href="/" className="brand" aria-label="Henar home">
          <HenarBrand />
        </Link>
        <nav aria-label="Main navigation">
          {[
            { path: "markets", label: "Markets", icon: ChartNoAxesCombined },
            { path: "trade", label: "Trade", icon: ArrowLeftRight },
            { path: "earn", label: "Earn", icon: Sprout },
            { path: "packs", label: "Packs", icon: Box },
          ].map(({ path, label, icon: Icon }) => {
            const active = page === path;
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
          <RewardsMenu />
          <span className="network">
            <i />
            Solana
          </span>
          <HeaderWallet />
        </div>
      </header>
      <main>
        {page === "portfolio" && <h1 className="sr-only">Portfolio</h1>}
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
              aria-label={`${mode === "dca" ? "DCA stock purchase" : mode === "limit" ? "Limit stock purchase" : "Market asset swap"}`}
            >
              <div className="ticket-toolbar">
                <h1>
                  {/* Company-first product language; the mint stays in the
                      route and execution detail below. */}
                  {mode === "market"
                    ? receiveStock
                      ? `Buy ${receiveStock.name}`
                      : paymentStock
                        ? `Sell ${paymentStock.name}`
                        : "Swap assets"
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
                      onClick={() => openAssetPicker("input")}
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
                aria-label="Switch input and output assets"
                disabled={busy || mode !== "market"}
                title={
                  mode === "market" ? "Switch assets" : "Yield orders use USDC"
                }
                onClick={() => {
                  setMarketPayment(receive);
                  setMarketReceive(payment);
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
                    {receive.provider ?? "Crypto"}
                  </span>
                </div>
                <div className="ticket-amount">
                  <div className="ticket-number-stack">
                    <input
                      aria-label={`${receive.symbol} receive amount`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={displayedOutputValue}
                      disabled={busy || mode === "dca"}
                      onChange={(e) => {
                        setReview(null);
                        setEditingOutput(true);
                        setEstimate(null);
                        setReceiveAmount(e.target.value);
                      }}
                    />
                    {displayedOutputUsd && (
                      <small className="ticket-usd-value">
                        ≈ {displayedOutputUsd}
                      </small>
                    )}
                  </div>
                  <button
                    className="token-chip"
                    onClick={() =>
                      mode === "market"
                        ? openAssetPicker("output")
                        : setPicker(true)
                    }
                    disabled={busy}
                    aria-label="Select receive asset"
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
                      ? `${formatUnits(review.protocolFee, review.feeDecimals)} ${review.feeMint === payment.mint ? payment.symbol : receive.symbol}`
                      : mode === "market"
                        ? "Available with quote"
                        : `${fee} USDC`}
                  </Row>
                  <Row label="Slippage tolerance">0.50%</Row>
                  <Row label="Price impact">
                    {review ? `${Number(review.priceImpactPct) * 100}%` : "—"}
                  </Row>
                  {review?.route.routePlan.length ? (
                    <Row label="Execution route">
                      {[
                        ...new Set(
                          review.route.routePlan.map(
                            (step) => step.swapInfo.label ?? "Liquidity venue",
                          ),
                        ),
                      ].join(" · ")}{" "}
                      via Jupiter
                    </Row>
                  ) : null}
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
                      {BigInt(review.feeAccountRent ?? "0") > 0n && (
                        <Row label="Includes protocol account setup">
                          {formatUnits(review.feeAccountRent!, 9)} SOL
                        </Row>
                      )}
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
                <p
                  role="status"
                  className="status-message"
                  data-transaction-tone={transactionTone}
                >
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
                      !productAvailable(
                        protocol.data,
                        mode === "limit" ? 2 : 4,
                      ) ||
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
                    data-transaction-tone={busy ? transactionTone : undefined}
                    disabled={busy || !wallet.signTransaction}
                    onClick={built && !expired ? buy : getQuote}
                  >
                    {busy
                      ? status || "Getting quote…"
                      : !wallet.signTransaction
                        ? "Wallet cannot sign"
                        : built && !expired
                          ? `Swap ${payment.symbol} for ${receive.symbol}`
                          : expired
                            ? "Refresh quote"
                            : "Review swap"}
                  </button>
                )}
              </div>
              {mode === "market" && (
                <section className="live-quotes" aria-label="Live execution quotes">
                  <div className="live-quotes-head">
                    <div>
                      <span className="quote-live-dot" aria-hidden="true" />
                      <strong>Best quote</strong>
                      <span className="quote-count">
                        {estimate?.alternatives
                          ? `${estimate.alternatives} routes`
                          : "Live routes"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={estimating ? "quote-refresh spinning" : "quote-refresh"}
                      onClick={() => setQuoteRefresh((n) => n + 1)}
                      disabled={estimating}
                      aria-label="Refresh quotes"
                    >
                      <RefreshCw size={13} />
                      {estimating ? "Updating" : "Live"}
                    </button>
                  </div>
                  {rankedCandidates.length ? (
                    <div
                      className="quote-list"
                      key={`${rankedCandidates[0].source}-${rankedCandidates[0].output}`}
                      aria-live="polite"
                    >
                      {rankedCandidates.slice(0, 4).map((candidate, index) => {
                        const source = getExecutionSourceBrand(candidate.source).label;
                        /* The row names the liquidity it was built over, like
                           every other row. The allocation, pool count and
                           impact belong in the route detail, not in a list a
                           user scans for a number. */
                        const allocation = candidate.henar
                          ? Array.from(new Set(candidate.legs.map((leg) => getExecutionSourceBrand(leg.venue).label))).join(" + ")
                          : Array.from(new Set(candidate.legs.map((step) => step.venue))).slice(0, 2).join(" · ");
                        return (
                          <div
                            className={index === 0 ? "quote-row best" : "quote-row"}
                            key={candidate.key}
                          >
                            <ExecutionSourceLogo source={candidate.source} />
                            <div className="quote-route">
                              <strong>{source}</strong>
                              <span>
                                {allocation || "Direct route"}
                                {!candidate.henar && candidate.providerFeeBps > 0
                                  ? ` · ${percent(candidate.providerFeeBps)} provider fee`
                                  : ""}
                              </span>
                            </div>
                            {index === 0 && <span className="best-badge">Best</span>}
                            <div className="quote-output">
                              <strong>
                                {new Decimal(candidate.output).toSignificantDigits(8).toFixed()} {receive.symbol}
                              </strong>
                              {usdEstimate(candidate.output, receiveUsdPrice) && (
                                <small>
                                  ≈ {usdEstimate(candidate.output, receiveUsdPrice)}
                                </small>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="quote-empty">
                      {estimateError || (estimating ? "Comparing live routes…" : "Enter an amount to compare routes")}
                    </div>
                  )}
                  <div className="quote-fee-note">
                    Ranked after provider fees · Net of Henar&apos;s {percent(tradeFeeBps)} fee
                  </div>
                </section>
              )}
              <div className="execution-caption">
                <ShieldCheck size={12} /> Self-custody <span>·</span>{" "}
                {review
                  ? "Execution route locked for review"
                  : mode === "market"
                    ? "Live multi-source comparison"
                    : "Onchain order"}
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
            {!connected && viewing ? (
              <div className="portfolio-viewing">
                <Eye size={15} />
                <span>
                  Viewing <b>{`${viewing.slice(0, 4)}…${viewing.slice(-4)}`}</b>{" "}
                  — read only. Connect a wallet to trade.
                </span>
                <button type="button" onClick={() => setViewing("")}>
                  Exit
                </button>
              </div>
            ) : null}
            <ProductSummary
              balances={owner && !balanceError ? balances : null}
            />
            {!owner ? (
              <div className="portfolio-empty portfolio-connect">
                <Wallet size={30} />
                <h2>Connect your wallet</h2>
                <p>Your stocks will appear here.</p>
                <WalletButton>
                  {!wallet.publicKey && !wallet.connecting
                    ? "Connect wallet"
                    : undefined}
                </WalletButton>
                <ViewAnyWallet onView={setViewing} />
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
          <Link href="/docs">Docs</Link>
          {disclosureStock && (
            <a
              href={disclosureStock.disclosures}
              target="_blank"
              rel="noreferrer"
            >
              Disclosures <ArrowUpRight size={12} />
            </a>
          )}
          <span>Henar</span>
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
                Select {assetPickerSide === "input" ? "input" : "output"} asset
              </h2>
              <input
                autoFocus
                aria-label="Search assets"
                placeholder="Search crypto, stocks, or paste a mint"
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
            <div className="asset-class-tabs" aria-label="Asset class">
              {[
                ["all", "All assets"],
                ["crypto", "Crypto"],
                ["stocks", "Stocks & ETFs"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={assetClass === value}
                  className={assetClass === value ? "active" : ""}
                  onClick={() => {
                    const next = value as "all" | "crypto" | "stocks";
                    setAssetClass(next);
                    if (next === "crypto") setAssetIssuer("all");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {assetClass !== "crypto" && (
              <div className="asset-issuer-tabs" aria-label="Stock issuer">
                <button
                  type="button"
                  aria-pressed={assetIssuer === "all"}
                  className={assetIssuer === "all" ? "active" : ""}
                  onClick={() => setAssetIssuer("all")}
                >
                  All issuers
                </button>
                {(["xStocks", "Backpack", "Ondo"] as const).map((provider) => (
                  <button
                    type="button"
                    key={provider}
                    aria-pressed={assetIssuer === provider}
                    className={assetIssuer === provider ? "active" : ""}
                    onClick={() => {
                      setAssetClass("stocks");
                      setAssetIssuer(provider);
                    }}
                  >
                    <Image
                      className="issuer-logo"
                      src={`/logos/issuers/${provider.toLowerCase()}.svg`}
                      width={18}
                      height={18}
                      alt=""
                      unoptimized
                    />
                    {provider}
                  </button>
                ))}
              </div>
            )}
            <div className="selector-columns asset-selector-columns">
              <span>
                Asset <span className="result-count">{paymentOptions.length.toLocaleString()}</span>
              </span>
              <span>Balance</span>
            </div>
            <div className="selector-results">
              {heldPaymentOptions.length > 0 && (
                <div className="selector-section-label">
                  <span>Your assets</span>
                  <span>Available balance</span>
                </div>
              )}
              {heldPaymentOptions.map((token) => (
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
                          {token.name}
                          {token.provider ? ` · ${token.provider}` : ""} · {token.mint.slice(0, 4)}…
                          {token.mint.slice(-4)}
                        </small>
                      </span>
                    </span>
                    <span className="selector-balance">
                      {balances?.[token.mint]
                        ? formatUnits(
                            balances[token.mint].amount,
                            balances[token.mint].decimals,
                            6,
                          )
                        : "—"}
                    </span>
                  </button>
                </div>
              ))}
              {catalogPaymentOptions.length > 0 && heldPaymentOptions.length > 0 && (
                <div className="selector-section-label catalog-label">
                  <span>Explore</span>
                  <span />
                </div>
              )}
              {catalogPaymentOptions.map((token) => (
                <div key={token.mint} className="selector-row">
                  <button
                    className="asset-choice"
                    disabled={resolvingPayment}
                    onClick={() => choosePayment(token)}
                  >
                    <span className="asset">
                      <TokenLogo token={token} />
                      <span>
                        <strong>{token.symbol}</strong>
                        <small>
                          {token.name}
                          {token.provider ? ` · ${token.provider}` : ""} · {token.mint.slice(0, 4)}…
                          {token.mint.slice(-4)}
                        </small>
                      </span>
                    </span>
                    <span className="selector-balance">—</span>
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
              <span>Exact verified Solana mints</span>
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
            <Row label="Market protocol fee">
              {(MARKET_FEE_BPS / 100).toFixed(2)}%
            </Row>
            <Row label="Routing">{routingSummary}</Row>
            <p>
              Network fees and account funding are shown with your executable
              quote.
            </p>
            {disclosureStock && (
              <a
                href={disclosureStock.disclosures}
                target="_blank"
                rel="noreferrer"
              >
                Read asset disclosures <ArrowUpRight size={14} />
              </a>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
