"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowUpRight,
  Download,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Buffer } from "buffer";
import { HenarBrand } from "./henar-brand";
import type { AdminSnapshot } from "@/lib/admin/types";
import { ADMIN_SESSION_MS, adminMessage } from "@/lib/admin/message";
import { formatUnits } from "@/lib/amount";
import styles from "@/app/admin/admin.module.css";
const money = (value: string | null) =>
  value === null ? "—" : `${formatUnits(value, 6)} USDC`;
const short = (value: string) => `${value.slice(0, 5)}…${value.slice(-5)}`;
const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString();
function explorer(address: string) {
  return `https://explorer.solana.com/address/${address}`;
}
export function AdminDashboard() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const owner = wallet.publicKey?.toBase58();
  const [session, setSession] = useState<{
    owner: string;
    token: string;
    expiresAt: number;
  } | null>(null);
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setSession(null);
    setData(null);
    setError("");
    setBusy(false);
    setQuery("");
    setPage(0);
  }, [owner]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        generation.current++;
        setSession(null);
        setData(null);
        setBusy(false);
        setError("Session expired. Sign in again.");
      },
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);
  async function load(token: string, version: number) {
    const response = await fetch("/api/admin/analytics", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const value = await response.json();
    if (version !== generation.current) return;
    if (!response.ok) {
      if (response.status === 401) {
        setSession(null);
        setData(null);
      }
      throw new Error(value.error || "Could not load analytics.");
    }
    setData(value);
    setError("");
  }
  async function login() {
    if (!owner || !wallet.signMessage || busy) return;
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/session?wallet=${encodeURIComponent(owner)}`,
        { cache: "no-store" },
      );
      const challenge = await res.json();
      if (!res.ok) throw new Error(challenge.error);
      if (challenge.wallet !== owner || !Number.isSafeInteger(challenge.issuedAt) || Math.abs(challenge.issuedAt - Date.now()) > 60_000 || challenge.expiresAt !== challenge.issuedAt + ADMIN_SESSION_MS || challenge.message !== adminMessage(window.location.origin, owner, challenge.issuedAt))
        throw new Error("Invalid admin sign-in message.");
      if (version !== generation.current) return;
      const signature = await wallet.signMessage(
        new TextEncoder().encode(challenge.message),
      );
      if (version !== generation.current) return;
      const token = Buffer.from(
        JSON.stringify({
          wallet: owner,
          issuedAt: challenge.issuedAt,
          signature: Buffer.from(signature).toString("base64"),
        }),
      ).toString("base64");
      setSession({ owner, token, expiresAt: challenge.expiresAt });
      await load(token, version);
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  async function refresh() {
    if (!session || busy) return;
    const version = generation.current;
    setBusy(true);
    try {
      await load(session.token, version);
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  const visibleData = session?.owner === owner ? data : null;
  const filtered =
    visibleData?.users.filter(
      (u) =>
        u.wallet.toLowerCase().includes(query.toLowerCase()) ||
        u.products.join(" ").toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const pageCount = Math.ceil(filtered.length / 10);
  function exportUsers() {
    if (!visibleData) return;
    const rows = [
      [
        "wallet",
        "products",
        "positions",
        "sealed_packs",
        "principal_basis_usdc",
        "first_record",
        "last_record",
      ],
      ...filtered.map((u) => [
        u.wallet,
        u.products.join("; "),
        String(u.positions),
        u.sealed,
        formatUnits(u.principal, 6),
        new Date(u.firstSeen * 1000).toISOString(),
        new Date(u.lastSeen * 1000).toISOString(),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "henar-protocol-wallets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Link href="/" className="brand" aria-label="Henar home">
            <HenarBrand />
          </Link>
          <span>Admin</span>
        </div>
        <div className={styles.actions}>
          <Link href="/trade">
            Open app <ArrowUpRight size={14} />
          </Link>
          {session && (
            <button
              onClick={() => {
                generation.current++;
                setSession(null);
                setData(null);
                setBusy(false);
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      {!visibleData ? (
        <main className={styles.gate}>
          <div className={styles.lock}>
            <LockKeyhole size={26} />
          </div>
          <span className={styles.eyebrow}>HENAR ADMIN</span>
          <h1>A closer look.</h1>
          <p>Analytics and operations for authorized wallets.</p>
          {owner && <span className={styles.wallet}>{short(owner)}</span>}
          <button
            className={styles.primary}
            disabled={busy || Boolean(owner && !wallet.signMessage)}
            onClick={() =>
              !owner ? setVisible(true) : session ? refresh() : login()
            }
          >
            {busy
              ? "Checking access…"
              : !owner
                ? "Connect wallet"
                : session
                  ? "Retry dashboard"
                  : "Sign in to admin"}
          </button>
          {owner && !wallet.signMessage && (
            <p>
              This wallet does not support message signing. Choose a compatible
              admin wallet.
            </p>
          )}
          {owner && (
            <button
              className={styles.switchWallet}
              onClick={() => setVisible(true)}
            >
              Switch wallet
            </button>
          )}
          <span className={styles.note}>
            Read-only · Signature expires after 5 minutes
          </span>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </main>
      ) : (
        <main className={styles.main}>
          <div className={styles.titleRow}>
            <div>
              <span className={styles.eyebrow}>OVERVIEW</span>
              <h1>Inside Henar</h1>
              <p>
                Observed {new Date(visibleData.observedAt).toLocaleString()}
              </p>
            </div>
            <button
              className={styles.refresh}
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw size={15} />
              {busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error} Showing the last successful snapshot.
            </p>
          )}
          <div className={styles.metrics}>
            {[
              [
                "Protocol wallets",
                String(visibleData.totals.wallets),
                "Owners in retained accounts",
              ],
              [
                "Principal basis",
                money(visibleData.totals.principal),
                "Accounting basis, not current TVL",
              ],
              [
                "Treasury balance",
                money(visibleData.treasury.balance),
                "Current balance, not revenue",
              ],
              [
                "Recorded pack fees",
                money(visibleData.totals.packFees),
                "Random settlements + Lucky openings",
              ],
            ].map(([label, value, note]) => (
              <div className={styles.metric} key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Revenue & activity</h2>
              <span>USDC · retained account records</span>
            </div>
            <p className={styles.caption}>
              Cash revenue by product needs transaction reconciliation. Yield
              fee accruals and pack fee records are shown separately below.
            </p>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    {[
                      "Product",
                      "Status",
                      "Wallets",
                      "Accounts",
                      "Yield fees recorded",
                      "Pack fees recorded",
                      "Stock budget delivered",
                    ].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleData.products.map((p) => (
                    <tr key={p.name}>
                      <th scope="row">{p.name}</th>
                      <td>
                        <span className={styles.status}>{p.status}</span>
                      </td>
                      <td>{p.wallets ?? "—"}</td>
                      <td>{p.accounts ?? "—"}</td>
                      <td>{money(p.recordedYieldFees)}</td>
                      <td>{money(p.recordedPackFees)}</td>
                      <td>{money(p.deliveredBudget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className={styles.twoColumns}>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>Operations</h2>
                <ShieldCheck size={17} />
              </div>
              <dl className={styles.details}>
                {[
                  [
                    "Contract",
                    visibleData.access.paused ? "Paused" : "Unpaused",
                  ],
                  [
                    "Access",
                    visibleData.access.pilotOwner ===
                    "11111111111111111111111111111111"
                      ? "Public policy"
                      : "Restricted pilot",
                  ],
                  ["Active orders", visibleData.totals.activeOrders],
                  ["Sealed packs", visibleData.totals.sealed],
                  ["Unsettled packs", visibleData.totals.pendingPacks],
                  ["Past settlement deadline", visibleData.totals.overduePacks],
                  ["Admission used", money(visibleData.access.admitted)],
                  ["Admission limit", money(visibleData.access.admissionLimit)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <a
                className={styles.chainLink}
                href={explorer(visibleData.programId)}
                target="_blank"
                rel="noreferrer"
              >
                View program <ArrowUpRight size={13} />
              </a>
            </section>
            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>Data coverage</h2>
              </div>
              <ul className={styles.coverage}>
                {visibleData.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className={styles.caption}>
                Website traffic, complete Market revenue, conversion, referral
                attribution, and worker health need dedicated data sources.
              </p>
              <a
                className={styles.chainLink}
                href={explorer(visibleData.treasury.address)}
                target="_blank"
                rel="noreferrer"
              >
                View treasury <ArrowUpRight size={13} />
              </a>
            </section>
          </div>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Wallets</h2>
                <span>{filtered.length} protocol wallets</span>
              </div>
              <button className={styles.refresh} onClick={exportUsers}>
                <Download size={14} />
                Export CSV
              </button>
            </div>
            <label className={styles.search}>
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search wallet or product"
                aria-label="Search wallets"
              />
            </label>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    {[
                      "Wallet",
                      "Products",
                      "Positions",
                      "Sealed packs",
                      "Principal basis",
                      "First record",
                      "Last record",
                    ].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(page * 10, page * 10 + 10).map((u) => (
                    <tr key={u.wallet}>
                      <td>
                        <a
                          title={u.wallet}
                          href={explorer(u.wallet)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(u.wallet)} ↗
                        </a>
                      </td>
                      <td>{u.products.join(", ")}</td>
                      <td>{u.positions}</td>
                      <td>{u.sealed}</td>
                      <td>{money(u.principal)}</td>
                      <td>{date(u.firstSeen)}</td>
                      <td>{date(u.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <p className={styles.empty}>No matching protocol wallets.</p>
            )}
            <div className={styles.pages}>
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {pageCount ? page + 1 : 0} / {pageCount}
              </span>
              <button
                disabled={page + 1 >= pageCount}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>Latest account records</h2>
              <span>Up to 30 · not a transaction history</span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Wallet</th>
                    <th>Status</th>
                    <th>Account timestamp</th>
                    <th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleData.activity.map((a) => (
                    <tr key={a.address}>
                      <td>{a.product}</td>
                      <td>{short(a.wallet)}</td>
                      <td>{a.status}</td>
                      <td>{new Date(a.timestamp * 1000).toLocaleString()}</td>
                      <td>
                        <a
                          href={explorer(a.address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(a.address)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visibleData.activity.length && (
              <p className={styles.empty}>
                No retained position or opened-pack records.
              </p>
            )}
          </section>
          <p className={styles.footer}>{visibleData.coverage}</p>
        </main>
      )}
    </div>
  );
}
