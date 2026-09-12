"use client";
import { AppSelect } from "./app-select";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { LuckyMode, type OpeningMode } from "./lucky-mode";
import { batchPackQuote, giftDraft } from "@/lib/pack-actions";
import {
  Info,
  ChartNoAxesCombined,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Backpack,
  LockKeyhole,
  Search,
  X,
} from "lucide-react";
import { formatUnits, parseUnits } from "@/lib/amount";
import { percent, type ProductConfig } from "@/lib/product-config";
import { type EarnPreferences } from "@/lib/earn-accounting";
import { stocks } from "@/lib/registry";
import { backpackPackCandidates } from "@/lib/pack-catalog";
import { EarnHistory } from "./earn-history";
import { useProtocol } from "./protocol-provider";
import { ProtocolInventory, ProtocolPositions } from "./protocol-inventory";
import { StockLogo } from "./stock-logo";

type Balances = Record<string, { amount: string; decimals: number }>;
function EarnInfo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="earn-info"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
      >
        <Info size={15} />
      </button>
      {open && (
        <span id={id} role="tooltip" className="earn-info-popover">
          {children}
        </span>
      )}
    </span>
  );
}
function Detail({
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
function ProductDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="product-dialog"
      ref={ref}
      aria-label={title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const bounds = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <div className="product-dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label={`Close ${title}`}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ResponsiveEarnTicket({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <div className="mobile-ticket-host">
      <div className="mobile-action-dock mobile-earn-launch">
        <button className="primary" onClick={() => setOpen(true)}>
          Deposit / Withdraw <ArrowUpRight size={17} />
        </button>
      </div>
      {mobile
        ? open && (
            <ProductDialog title="Manage USDC" close={() => setOpen(false)}>
              {children}
            </ProductDialog>
          )
        : children}
    </div>
  );
}
export function PackProgress({ compact = false }: { compact?: boolean }) {
  const { data } = useProtocol();
  const progress = data
    ? data.positions
        .filter((p) => "earn" in p.kind && "packs" in p.destination)
        .reduce(
          (n, p) =>
            BigInt(p.claimable) % 10000000n > n
              ? BigInt(p.claimable) % 10000000n
              : n,
          0n,
        )
    : null;
  return (
    <div className={`pack-progress ${compact ? "compact" : ""}`}>
      <div>
        <span>Next yield-earned pack</span>
        <span>
          {progress === null ? "—" : formatUnits(progress % 10000000n, 6)} / 10
          USDC
        </span>
      </div>
      <div
        className="progress-track"
        aria-label={
          progress === null
            ? "Pack progress unavailable"
            : "Progress toward next pack"
        }
      >
        <span
          style={{
            width: `${progress === null ? 0 : Number(progress % 10000000n) / 100000}%`,
          }}
        />
      </div>
      {!compact && (
        <p>
          Every 10 USDC of net yield becomes one sealed pack. Your principal
          stays deposited.
        </p>
      )}
    </div>
  );
}
export function EarnPage({
  owner,
  config,
  connect,
}: {
  owner?: string;
  config: ProductConfig;
  connect: React.ReactNode;
}) {
  const protocol = useProtocol();
  const live = protocol.data;
  config = live
    ? { yieldShareBps: live.yieldShareBps, packFeeBps: live.packFeeBps }
    : config;
  const [positionId, setPositionId] = useState("");
  const earningPositions =
    live?.positions.filter((p) => "earn" in p.kind && "active" in p.status) ??
    [];
  const chosenPosition =
    earningPositions.find((p) => p.address === positionId) ??
    earningPositions[0];
  const earnTotal = (
    field: "principalBasis" | "grossYield" | "yieldFees" | "claimable",
  ) =>
    live?.positions
      .filter((p) => "earn" in p.kind)
      .reduce((n, p) => n + BigInt(p[field]), 0n)
      .toString();
  const display = (value?: string) =>
    value === undefined ? "—" : formatUnits(BigInt(value), 6);
  const [action, setAction] = useState<"Deposit" | "Withdraw">("Deposit");
  const [chartMetric, setChartMetric] = useState<"APY" | "TVL">("APY");
  const [chartPeriod, setChartPeriod] = useState("30D");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState(false);
  const [withdrawFrom, setWithdrawFrom] = useState("principal");
  const [stockPicker, setStockPicker] = useState(false);
  const [stockSearch, setStockSearch] = useState("");
  const [stockCount, setStockCount] = useState(40);
  const [preferences, setPreferences] = useState<EarnPreferences>({
    destination: "packs",
    autoPacks: false,
    category: "Random",
  });
  const selectedStock = stocks.find(
    (stock) => stock.mint === preferences.stockMint,
  );
  const stockChoices = stocks.filter(
    (stock) =>
      stock.instrument === "Stock" &&
      (!live || live.stocks.some((s) => s.mint === stock.mint)) &&
      `${stock.name} ${stock.ticker} ${stock.provider}`
        .toLowerCase()
        .includes(stockSearch.toLowerCase()),
  );
  // These are deposit instruction drafts, never an active onchain preference.
  // Wallet changes discard drafts and any in-progress review.
  useEffect(() => {
    setAction("Deposit");
    setStockPicker(false);
    setWithdrawFrom("principal");
    setAmount("");
    setReview(false);
    setPreferences({
      destination: "packs",
      autoPacks: false,
      category: "Random",
    });
  }, [owner]);
  const loadedPosition = useRef("");
  useEffect(() => {
    const key = `${owner ?? ""}:${chosenPosition?.address ?? ""}`;
    if (loadedPosition.current === key) return;
    loadedPosition.current = key;
    if (chosenPosition)
      setPreferences({
        destination:
          "stocks" in chosenPosition.destination ? "stocks" : "packs",
        autoPacks: chosenPosition.autoPacks,
        category: "Random",
        stockMint: chosenPosition.stockMint,
      });
  }, [owner, chosenPosition]);
  let valid = false;
  let exact = "";
  try {
    const value = parseUnits(amount, 6);
    valid = value > 0n;
    exact = formatUnits(value, 6);
  } catch {}
  function open(next: "Deposit" | "Withdraw") {
    setAction(next);
    setReview(false);
    setAmount("");
  }
  return (
    <div className="earn-layout earn-dashboard">
      <section className="earn-overview" aria-label="Earn overview">
        <div className="section-heading">
          <h1>USDC Earn</h1>
          <span className="product-status">
            <LockKeyhole size={12} />{" "}
            {live
              ? live.paused
                ? "Deposits paused"
                : "Mainnet"
              : "Not live yet"}
          </span>
        </div>
        <div className="earn-headline-metrics">
          <div className="earn-apy earn-apy-hero">
            <span>
              Variable APY{" "}
              <EarnInfo label="About variable APY">
                Vault APY before Kani Markets’ yield share. Variable, not
                guaranteed. Rates are provided by Kamino.
              </EarnInfo>
            </span>
            <strong>
              {live?.apy?.toFixed(2) ?? "—"}
              <small>%</small>
            </strong>
          </div>
          <div className="earn-tvl">
            <span>
              Total value locked{" "}
              <EarnInfo label="About TVL">
                Total USDC across the connected Kamino vault.
              </EarnInfo>
            </span>
            <strong>
              {live?.tvl ?? "—"} <small>USDC</small>
            </strong>
          </div>
        </div>
        <div className="earn-chart">
          <div className="earn-chart-toolbar">
            <div className="earn-chart-tabs" aria-label="Chart metric">
              {(["APY", "TVL"] as const).map((metric) => (
                <button
                  key={metric}
                  aria-pressed={chartMetric === metric}
                  onClick={() => setChartMetric(metric)}
                >
                  {metric}
                </button>
              ))}
            </div>
            <div
              className="earn-chart-tabs earn-chart-periods"
              aria-label="Chart period"
            >
              {["7D", "30D", "90D"].map((period) => (
                <button
                  key={period}
                  aria-pressed={chartPeriod === period}
                  onClick={() => setChartPeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <EarnHistory
            vault={live?.vault}
            metric={chartMetric}
            period={chartPeriod}
          />
        </div>
        <div className="earn-personal-metrics">
          <div>
            <span>Your deposit</span>
            <strong>
              {display(earnTotal("principalBasis"))} <small>USDC</small>
            </strong>
          </div>
          <div>
            <span>
              Net earnings{" "}
              <EarnInfo label="About net earnings">
                Your generated yield after the {percent(config.yieldShareBps)}{" "}
                protocol share, including yield allocated to packs or stocks.
              </EarnInfo>
            </span>
            <strong>
              {live
                ? display(
                    (
                      BigInt(earnTotal("grossYield") ?? "0") -
                      BigInt(earnTotal("yieldFees") ?? "0")
                    ).toString(),
                  )
                : "—"}{" "}
              <small>USDC</small>
            </strong>
          </div>
          <div>
            <span>
              Available yield{" "}
              <EarnInfo label="About available yield">
                Unspent net yield in USDC. Yield already allocated to sealed
                packs is excluded.
              </EarnInfo>
            </span>
            <strong>
              {display(earnTotal("claimable"))} <small>USDC</small>
            </strong>
          </div>
        </div>
        <div className="earn-overview-bottom">
          <details className="earn-yield-disclosure">
            <summary>
              Yield breakdown <ChevronRight size={14} />
            </summary>
            <Detail label="Gross yield accrued">
              {display(earnTotal("grossYield"))} USDC
            </Detail>
            <Detail label={`Protocol share · ${percent(config.yieldShareBps)}`}>
              {display(earnTotal("yieldFees"))} USDC
            </Detail>
          </details>
          <Link href="/packs">
            <Box size={15} /> Sealed packs{" "}
            <strong>{live?.summary.sealed ?? "—"}</strong>
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <PackProgress compact />
      </section>
      <ProtocolPositions earnOnly />
      <ResponsiveEarnTicket>
        <aside className="earn-ticket" aria-label="USDC deposit and withdrawal">
          <div
            className="product-segments earn-ticket-actions"
            aria-label="Earn action"
          >
            {(["Deposit", "Withdraw"] as const).map((next) => (
              <button
                key={next}
                aria-pressed={action === next}
                onClick={() => open(next)}
              >
                {next}
              </button>
            ))}
          </div>
          {action === "Withdraw" && (
            <div className="product-segments" aria-label="Withdraw from">
              {["principal", "yield"].map((from) => (
                <button
                  key={from}
                  aria-pressed={withdrawFrom === from}
                  onClick={() => setWithdrawFrom(from)}
                >
                  {from === "principal" ? "Principal" : "Claimable yield"}
                </button>
              ))}
            </div>
          )}
          <label className="product-amount earn-ticket-amount">
            {action} amount
            <div>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                aria-label={`${action} USDC amount`}
              />
              <span>USDC</span>
            </div>
            <small>
              {action === "Deposit"
                ? "Wallet balance"
                : "Available to withdraw"}
              <span>— USDC</span>
            </small>
          </label>
          {amount && !valid && (
            <p role="alert" className="error-message">
              Enter a positive USDC amount with at most 6 decimals.
            </p>
          )}
          {action === "Deposit" ? (
            <div className="earn-preferences">
              <div className="section-heading">
                <h2>Earn in</h2>
                <EarnInfo label="About yield destinations">
                  These are preferences for your next deposit, applied only
                  after confirmation. Principal stays deposited in USDC; only
                  net yield funds packs or stocks.
                </EarnInfo>
              </div>
              <div className="product-segments" aria-label="Yield destination">
                {(["packs", "stocks"] as const).map((destination) => (
                  <button
                    key={destination}
                    aria-pressed={preferences.destination === destination}
                    onClick={() =>
                      setPreferences((p) => ({ ...p, destination }))
                    }
                  >
                    {destination === "packs" ? (
                      <Box size={15} />
                    ) : (
                      <ChartNoAxesCombined size={15} />
                    )}
                    {destination === "packs" ? "Packs" : "Stocks"}
                  </button>
                ))}
              </div>
              {preferences.destination === "packs" ? (
                <>
                  <div className="auto-packs-row">
                    <div>
                      <h2>
                        Auto Packs{" "}
                        <EarnInfo label="How Auto Packs works">
                          Every 10 USDC of net user yield creates a sealed Stock
                          Pack when enabled. Principal is never used. Packs stay
                          sealed until you open them. When off, yield remains
                          available.
                        </EarnInfo>
                      </h2>
                    </div>
                    <button
                      role="switch"
                      aria-checked={preferences.autoPacks}
                      aria-label="Auto Packs"
                      className={`product-switch ${preferences.autoPacks ? "on" : ""}`}
                      onClick={() =>
                        setPreferences((p) => ({
                          ...p,
                          autoPacks: !p.autoPacks,
                        }))
                      }
                    >
                      <span />
                    </button>
                  </div>
                  <div className="earn-fixed-pack">
                    <Backpack size={18} />
                    <span>
                      <strong>Stock Pack</strong>
                      <small>10 USDC of net yield</small>
                    </span>
                    <Link href="/packs" aria-label="View Stock Pack">
                      <ArrowUpRight size={15} />
                    </Link>
                  </div>
                </>
              ) : (
                <div className="yield-cash">
                  <span className="yield-choice-label">
                    Stock to accumulate
                  </span>
                  <button
                    className="yield-stock-select"
                    onClick={() => {
                      setStockPicker(true);
                      setStockSearch("");
                      setStockCount(40);
                    }}
                    aria-label="Select yield stock"
                  >
                    {selectedStock ? (
                      <>
                        <StockLogo stock={selectedStock} small />
                        <span>
                          <strong>{selectedStock.name}</strong>
                          <small>
                            {selectedStock.ticker} · {selectedStock.provider}
                          </small>
                        </span>
                      </>
                    ) : (
                      <span>Select stock</span>
                    )}
                    <ChevronRight size={16} />
                  </button>
                  <Detail label="Net yield available to invest">— USDC</Detail>
                  <Detail label="Stock units acquired">—</Detail>
                </div>
              )}
              <div className="earn-preference-footer">
                <span>Yield share · {percent(config.yieldShareBps)}</span>
                <EarnInfo label="About the protocol yield share">
                  The protocol receives {percent(config.yieldShareBps)} of
                  generated yield. The rest belongs to you. Stock purchases and
                  pack opening are not live yet. Unspent yield stays in USDC
                  until confirmed execution.
                </EarnInfo>
                <span className="draft-label">Draft</span>
              </div>
            </div>
          ) : (
            <div className="earn-withdraw-note">
              <span>Withdrawal details</span>
              <EarnInfo label="About withdrawals">
                Principal and claimable yield are withdrawn separately.
                Sealed-pack allocations are excluded. Vault losses can reduce
                the value available to withdraw; fees require a live quote.
              </EarnInfo>
            </div>
          )}
          {action === "Withdraw" && earningPositions.length > 1 && (
            <label>
              Position
              <AppSelect
                label="Position"
                value={chosenPosition?.address ?? ""}
                onChange={setPositionId}
                options={earningPositions.map((p) => ({
                  value: p.address,
                  label: `${p.address.slice(0, 6)} · ${display(p.principalBasis)} USDC`,
                }))}
              />
            </label>
          )}
          {chosenPosition && action === "Deposit" && (
            <button
              className="product-back"
              disabled={
                protocol.busy ||
                (preferences.destination === "stocks" && !selectedStock)
              }
              onClick={() =>
                protocol.run({
                  action: "preferences",
                  account: chosenPosition.address,
                  destination: preferences.destination,
                  autoPacks: preferences.autoPacks,
                  stockMint: selectedStock?.mint,
                })
              }
            >
              Save yield preferences
            </button>
          )}
          <div className="earn-ticket-submit">
            {!owner ? (
              <div className="connect-action">{connect}</div>
            ) : (
              <button
                className="primary"
                disabled={
                  !valid ||
                  (action === "Deposit" &&
                    preferences.destination === "stocks" &&
                    !selectedStock)
                }
                onClick={() => setReview(true)}
              >
                Review {action.toLowerCase()} <ArrowUpRight size={16} />
              </button>
            )}
            <span className="earn-ticket-status">
              <LockKeyhole size={11} />{" "}
              {live ? "Confirmed on Solana" : "Vault not connected"}
            </span>
          </div>
        </aside>
      </ResponsiveEarnTicket>
      {stockPicker && (
        <ProductDialog
          title="Choose yield stock"
          close={() => setStockPicker(false)}
        >
          <label className="pack-search">
            <Search size={16} />
            <input
              autoFocus
              value={stockSearch}
              onChange={(e) => {
                setStockSearch(e.target.value);
                setStockCount(40);
              }}
              placeholder="Search company or ticker"
              aria-label="Search yield stocks"
            />
          </label>
          <div className="yield-stock-results">
            {stockChoices.slice(0, stockCount).map((stock) => (
              <button
                key={stock.mint}
                onClick={() => {
                  setPreferences((p) => ({ ...p, stockMint: stock.mint }));
                  setStockPicker(false);
                }}
              >
                <StockLogo stock={stock} small />
                <span>
                  <strong>{stock.name}</strong>
                  <small>
                    {stock.ticker} · {stock.provider}
                  </small>
                </span>
                {stock.mint === preferences.stockMint && <Check size={15} />}
              </button>
            ))}
            {!stockChoices.length && (
              <p className="product-caption">No matching stocks.</p>
            )}
            {stockChoices.length > stockCount && (
              <button
                className="load-stocks"
                onClick={() => setStockCount((v) => v + 40)}
              >
                Show more
              </button>
            )}
          </div>
        </ProductDialog>
      )}
      {review && (
        <ProductDialog
          title={`Review ${action.toLowerCase()}`}
          close={() => setReview(false)}
        >
          <Detail label={`${action} amount`}>{exact} USDC</Detail>
          {action === "Withdraw" ? (
            <Detail label="Source">
              {withdrawFrom === "principal"
                ? "Deposited principal"
                : "Claimable net yield"}
            </Detail>
          ) : (
            <>
              <Detail label="Yield destination">
                {preferences.destination === "packs" ? "Packs" : "Stocks"}
              </Detail>
              {preferences.destination === "stocks" && (
                <Detail label="Selected stock">
                  {selectedStock
                    ? `${selectedStock.ticker} · ${selectedStock.provider}`
                    : "Not selected"}
                </Detail>
              )}
              <Detail label="Auto Packs">
                {preferences.destination === "packs" && preferences.autoPacks
                  ? "On · Stock Pack · 10 USDC"
                  : "Off"}
              </Detail>
            </>
          )}
          <Detail label="Protocol share of generated yield">
            {percent(config.yieldShareBps)}
          </Detail>
          <Detail label="Network / vault fees">
            Calculated before signature
          </Detail>
          {!live && (
            <p className="product-unavailable">
              The mainnet vault is not connected yet.
            </p>
          )}
          <button
            className="primary"
            disabled={
              !live ||
              protocol.busy ||
              (action === "Deposit" && live.paused) ||
              (action === "Withdraw" && !chosenPosition)
            }
            onClick={() => {
              setReview(false);
              protocol.run({
                action:
                  action === "Deposit"
                    ? "deposit"
                    : withdrawFrom === "principal"
                      ? "withdraw"
                      : "claim",
                account: chosenPosition?.address,
                amount: parseUnits(amount, 6).toString(),
                destination: preferences.destination,
                autoPacks: preferences.autoPacks,
                stockMint: selectedStock?.mint,
              });
            }}
          >
            Get transaction preview
          </button>
          <button className="product-back" onClick={() => setReview(false)}>
            Edit amount
          </button>
        </ProductDialog>
      )}
    </div>
  );
}
export function PacksPage({
  config,
  owner,
}: {
  config: ProductConfig;
  owner?: string;
}) {
  const protocol = useProtocol();
  const live = protocol.data;
  config = live
    ? { yieldShareBps: live.yieldShareBps, packFeeBps: live.packFeeBps }
    : config;
  const [openingMode, setOpeningMode] = useState<OpeningMode>("random");
  const [giftBatch, setGiftBatch] = useState("");
  const sealed = live?.batches.filter((b) => BigInt(b.remaining) > 0n) ?? [];
  const chosenBatch = sealed.find((b) => b.address === giftBatch) ?? sealed[0];
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [review, setReview] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [customQuantity, setCustomQuantity] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftReview, setGiftReview] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [giftQuantity, setGiftQuantity] = useState("1");
  const [message, setMessage] = useState("");
  let gift = null;
  let giftError = "";
  try {
    gift = giftDraft(recipient, message, giftQuantity, owner);
  } catch (error) {
    if (recipient)
      giftError =
        error instanceof Error ? error.message : "Invalid gift details.";
  }

  useEffect(() => {
    setReview(false);
    setGiftOpen(false);
    setGiftReview(false);
    setOpeningMode("random");
    setRecipient("");
    setMessage("");
  }, [owner]);
  let quote = null;
  let quantityError = "";
  try {
    quote = batchPackQuote(quantity, config.packFeeBps);
  } catch (error) {
    quantityError =
      error instanceof Error ? error.message : "Invalid quantity.";
  }
  const candidates = live
    ? stocks.filter((s) =>
        live.stocks.some((m) => m.mint === s.mint && m.packEligible),
      )
    : backpackPackCandidates();
  const filtered = candidates.filter((stock) =>
    `${stock.name} ${stock.ticker}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const money = (value: bigint) => {
    const [whole, fraction = ""] = formatUnits(value, 6).split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  };
  return (
    <div className="backpack-market">
      <h1 className="sr-only">Packs</h1>
      <section className="backpack-offer" aria-label="Stock Pack">
        <div className="backpack-stage backpack-render-stage">
          <div className="backpack-render closed">
            <Image
              className="closed-backpack"
              src="/art/backpack-closed.png"
              alt="Sealed red backpack"
              width={1280}
              height={1280}
              priority
              unoptimized
            />
            <span className="backpack-flash" aria-hidden="true" />
          </div>
          <span className="backpack-state-label" aria-live="polite">
            <LockKeyhole size={12} />
            Sealed
          </span>
          <details className="pack-execution-details">
            <summary>How unpacking works</summary>
            <p>
              Unpack selects a stock using verifiable randomness. Kani requests
              a Jupiter quote, and the contract swaps your allocation into your
              wallet before the reveal.
            </p>
            <p>
              Kani chooses the quote. The contract checks the stock, recipient,
              exact spend, quote expiry and minimum received. There is no
              independent price oracle. Network and randomness fees are
              separate.
            </p>
            <p>
              If execution fails, your unspent allocation stays in escrow for
              retry or recovery after the deadline. Onchain activity is public
              before the visual reveal.
            </p>
          </details>
        </div>
        <div className="backpack-purchase">
          <div className="backpack-product-tag">
            <Backpack size={14} /> Backpack Securities{" "}
            <span>{openingMode === "lucky" ? "Lucky" : "Random"}</span>
          </div>
          <h2>Stock Pack</h2>
          <div className="backpack-offer-meta">
            <a href="#possible-stocks">
              {candidates.length} possible stocks <ArrowUpRight size={13} />
            </a>
            <span>Equal odds</span>
            <EarnInfo label="About selection odds">
              Each mint in this catalog preview has a 1 in {candidates.length}{" "}
              chance. The eligible manifest must be fixed before purchase.
              Opening requires your action and verifiable onchain randomness.
            </EarnInfo>
          </div>
          <div className="backpack-price">
            {quote ? `$${formatUnits(quote.price, 6)}` : "—"} <span>USDC</span>
          </div>
          <LuckyMode
            mode={openingMode}
            onChange={setOpeningMode}
            stake={quote ? quote.stockValue / quote.quantity : 9_800_000n}
            enabled={!!live?.luckyPool?.enabled}
          />
          <div className="pack-quantity-selector">
            <span>
              Quantity <small>10 USDC each</small>
            </span>
            <div className="product-segments" aria-label="Pack quantity">
              {["1", "5", "10"].map((count) => (
                <button
                  key={count}
                  aria-pressed={!customQuantity && quantity === count}
                  onClick={() => {
                    setQuantity(count);
                    setCustomQuantity(false);
                  }}
                >
                  {count}
                </button>
              ))}
              <button
                aria-pressed={customQuantity}
                onClick={() => setCustomQuantity(true)}
              >
                Custom
              </button>
            </div>
            {customQuantity && (
              <input
                aria-label="Custom pack quantity"
                inputMode="numeric"
                maxLength={13}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            )}
            {quantityError && (
              <p className="error-message" role="alert">
                {quantityError}
              </p>
            )}
          </div>
          <div className="backpack-price-details">
            <Detail
              label={
                openingMode === "lucky"
                  ? "Budget before Lucky outcome"
                  : "Stock allocation"
              }
            >
              {quote ? money(quote.stockValue) : "—"} USDC
            </Detail>
            <Detail label={`Protocol fee · ${percent(config.packFeeBps)}`}>
              {quote ? money(quote.fee) : "—"} USDC
            </Detail>
          </div>
          <div className="mobile-action-dock pack-purchase-action">
            <button
              className="primary"
              disabled={!quote}
              onClick={() => setReview(true)}
            >
              Buy {quote?.quantity.toString() ?? ""}{" "}
              {quote?.quantity === 1n ? "Pack" : "Packs"}{" "}
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="backpack-launch-status">
            <LockKeyhole size={12} />{" "}
            {live
              ? live.paused
                ? "Purchases paused"
                : "Mainnet · USDC"
              : "Purchase preview · Not live yet"}
          </div>
          <Link className="backpack-earn-link" href="/earn">
            <span>
              <strong>Or earn a pack with yield</strong>
              <small>10 USDC toward stock · No extra protocol fee</small>
            </span>
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </section>
      <section className="backpack-stock-section" id="possible-stocks">
        <div className="backpack-stock-heading">
          <div>
            <h2>
              Possible stocks <span>{candidates.length}</span>
            </h2>
            <EarnInfo label="About the stock catalog">
              Issuer-published Backpack Solana stock mints. Liquidity and
              eligibility must be checked before the final pack list is locked.
              Listing does not guarantee a tradable route.
            </EarnInfo>
          </div>
          <label className="pack-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setExpanded(false);
              }}
              placeholder="Search stocks"
              aria-label="Search possible stocks"
            />
          </label>
        </div>
        <div className="backpack-stock-grid">
          {filtered
            .slice(0, expanded || search ? filtered.length : 12)
            .map((stock) => (
              <div className="backpack-stock" key={stock.mint}>
                <StockLogo stock={stock} />
                <span>
                  <strong>{stock.name}</strong>
                  <small>{stock.ticker}</small>
                </span>
                <span className="stock-odds">1 / {candidates.length}</span>
              </div>
            ))}
        </div>
        {!filtered.length && (
          <p className="backpack-no-results">No matching stocks.</p>
        )}
        {!search && candidates.length > 12 && (
          <button
            className="backpack-expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Show fewer stocks"
              : `View all ${candidates.length} stocks`}
            <ChevronRight size={14} />
          </button>
        )}
      </section>
      <section className="backpack-inventory" id="sealed-packs">
        <div className="backpack-inventory-heading">
          <h2>
            Your packs <span>{live?.summary.sealed ?? "—"}</span>
          </h2>
          <Link href="/stockfolio">
            Stockfolio <ArrowUpRight size={14} />
          </Link>
        </div>
        <ProtocolInventory openingMode={openingMode} />
        <div className="pack-inventory-actions">
          <button
            className="secondary"
            disabled={!chosenBatch}
            onClick={() => {
              setGiftOpen(true);
              setGiftReview(false);
            }}
          >
            Send packs <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="backpack-inventory-body">
          {!live && (
            <div className="backpack-sealed-empty">
              <Box size={27} />
              <div>
                <strong>
                  {owner
                    ? "Inventory unavailable"
                    : "Your packs, ready when you are"}
                </strong>
                <p>
                  {owner
                    ? "The pack program is not connected yet."
                    : "Connect a wallet to view your sealed packs."}
                </p>
              </div>
            </div>
          )}
          <div className="backpack-earned-progress">
            <span className="earned-badge">Earned</span>
            <PackProgress compact />
            <Link href="/earn">
              Set up Auto Packs <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
      </section>
      {giftOpen && (
        <ProductDialog
          title={giftReview ? "Review gift" : "Send sealed packs"}
          close={() => setGiftOpen(false)}
        >
          {!giftReview ? (
            <>
              <label className="gift-field">
                Recipient wallet
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Solana address"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="gift-field">
                Sealed packs
                <input
                  inputMode="numeric"
                  value={giftQuantity}
                  maxLength={13}
                  onChange={(e) => setGiftQuantity(e.target.value)}
                />
              </label>
              <label className="gift-field">
                Message <span>Optional</span>
                <textarea
                  value={message}
                  maxLength={280}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A little something for you."
                  rows={3}
                />
              </label>
              <p className="product-caption">
                Messages will be public onchain. Only sealed packs can be sent.
              </p>
              {giftError && (
                <p role="alert" className="error-message">
                  {giftError}
                </p>
              )}
              <button
                className="primary"
                disabled={!gift}
                onClick={() => setGiftReview(true)}
              >
                Review gift
              </button>
            </>
          ) : (
            <>
              {sealed.length > 1 && (
                <label>
                  From
                  <AppSelect
                    label="Pack batch"
                    value={chosenBatch?.address ?? ""}
                    onChange={setGiftBatch}
                    options={sealed.map((b) => ({
                      value: b.address,
                      label: `${b.address.slice(0, 6)} · ${b.remaining} packs`,
                    }))}
                  />
                </label>
              )}
              <Detail label="Sealed packs">{gift?.quantity.toString()}</Detail>
              <div className="gift-recipient">
                <span>Recipient</span>
                <strong>{gift?.recipient}</strong>
              </div>
              {message && <div className="gift-message">{message}</div>}
              <Detail label="Network fee">Awaiting live quote</Detail>
              <button
                className="primary"
                disabled={!chosenBatch || !gift || protocol.busy}
                onClick={() => {
                  setGiftOpen(false);
                  protocol.run({
                    action: "gift",
                    account: chosenBatch?.address,
                    count: gift?.quantity.toString(),
                    recipient: gift?.recipient,
                    message,
                  });
                }}
              >
                Get transfer preview
              </button>
              <button
                className="product-back"
                onClick={() => setGiftReview(false)}
              >
                Edit gift
              </button>
            </>
          )}
        </ProductDialog>
      )}
      {review && (
        <ProductDialog
          title="Review pack purchase"
          close={() => setReview(false)}
        >
          <div className="pack-detail-meta">
            <span>Stock Pack</span>
            <span className="product-status">Direct purchase</span>
          </div>
          <Detail label="Quantity">
            {quote?.quantity.toString()} sealed packs
          </Detail>
          <Detail label="Total price">
            {quote ? money(quote.price) : "—"} USDC
          </Detail>
          <Detail label={`Protocol fee · ${percent(config.packFeeBps)}`}>
            {quote ? money(quote.fee) : "—"} USDC
          </Detail>
          <Detail label="Stock allocation">
            {quote ? money(quote.stockValue) : "—"} USDC
          </Detail>
          {openingMode === "lucky" && (
            <p className="lucky-mode-note">
              This purchase creates refundable sealed packs. Lucky odds and fees
              are confirmed separately when opening; availability depends on
              reserves.
            </p>
          )}
          <Detail label="Selection odds">
            Equal · 1 in {candidates.length}
          </Detail>
          <Detail label="Network fee">Calculated before signature</Detail>
          <Detail label="Randomness fee">Paid when you open each pack</Detail>
          {!live && (
            <p className="product-unavailable">
              The mainnet pack program is not connected yet.
            </p>
          )}
          <button
            className="primary"
            disabled={!live || live.paused || protocol.busy || !quote}
            onClick={() => {
              setReview(false);
              protocol.run({
                action: "buy",
                count: quote?.quantity.toString(),
              });
            }}
          >
            Get purchase preview
          </button>
        </ProductDialog>
      )}
    </div>
  );
}
export function ProductSummary({ balances }: { balances: Balances | null }) {
  const { data } = useProtocol();
  const supported = balances
    ? stocks.filter((s) => BigInt(balances[s.mint]?.amount ?? "0") > 0n).length
    : null;
  return (
    <div className="product-summary">
      {[
        {
          label: "Earning Cash",
          value: data ? formatUnits(BigInt(data.summary.principal), 6) : "—",
          unit: "USDC",
          href: "/earn",
        },
        {
          label: "Stocks",
          value: supported === null ? "—" : String(supported),
          unit: "holdings",
          href: "#stock-holdings",
        },
        {
          label: "Active Orders",
          value: data ? String(data.summary.activeOrders) : "—",
          unit: "orders",
          href: "/trade",
        },
        {
          label: "Sealed Packs",
          value: data?.summary.sealed ?? "—",
          unit: "packs",
          href: "/packs",
        },
      ].map((item) => (
        <Link key={item.label} href={item.href}>
          <span>
            {item.label}
            <ArrowUpRight size={13} />
          </span>
          <strong>
            {item.value} <small>{item.unit}</small>
          </strong>
        </Link>
      ))}
    </div>
  );
}
