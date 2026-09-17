"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowLeftRight, ArrowRight, Box, ChartNoAxesCombined, ChevronDown, FlaskConical, LogOut, Sprout, User, Wallet } from "lucide-react";
import { HenarBrand } from "./henar-brand";
import { RewardsMenu } from "./rewards-menu";
import { ThemeToggle } from "./theme-toggle";

/* Studio is behind the same public flag the route itself checks, so the link
   exists exactly when the page does. It was reachable only from the admin
   dashboard, which meant the DBC work was effectively invisible to anyone who
   did not already know the URL. */
const navigation = [
  { path: "markets", label: "Markets", icon: ChartNoAxesCombined },
  { path: "trade", label: "Trade", icon: ArrowLeftRight },
  { path: "earn", label: "Earn", icon: Sprout },
  { path: "packs", label: "Packs", icon: Box },
  ...(process.env.NEXT_PUBLIC_HENAR_DBC_STUDIO === "1"
    ? [{ path: "studio", label: "Studio", icon: FlaskConical }]
    : []),
];

function MarketsWallet() {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);
  if (!wallet.publicKey)
    return (
      <button
        className="wallet-adapter-button wallet-adapter-button-trigger header-wallet-connect"
        onClick={() => setVisible(true)}
      >
        <Wallet size={14} />
        {wallet.connecting ? "Connecting…" : "Connect"}
      </button>
    );
  const address = wallet.publicKey.toBase58();
  const walletName = wallet.wallet?.adapter.name ?? "Solana wallet";
  return (
    <div className="wallet-adapter-dropdown header-wallet" ref={root}>
      <button
        className="wallet-adapter-button wallet-adapter-button-trigger header-wallet-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="header-wallet-avatar">
          <Wallet size={13} />
          <i />
        </span>
        <span className="header-wallet-address">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
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
              {address.slice(0, 8)}…{address.slice(-6)}
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
              className="wallet-adapter-dropdown-list-item header-wallet-disconnect"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                wallet.disconnect();
              }}
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

export function AppHeader({ active }: { active: string }) {
  return (
    <header className="app-header">
      <Link href="/" className="brand" aria-label="Henar home">
        <HenarBrand />
      </Link>
      <nav aria-label="Main navigation">
        {navigation.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            href={`/${path}`}
            className={active === path ? "active" : ""}
            aria-current={active === path ? "page" : undefined}
          >
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" /> {label}
          </Link>
        ))}
      </nav>
      <div className="header-right">
        <ThemeToggle />
        <RewardsMenu />
        <MarketsWallet />
      </div>
    </header>
  );
}
