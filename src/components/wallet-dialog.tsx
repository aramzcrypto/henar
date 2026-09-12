"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { ArrowUpRight, ChevronDown, Wallet, X } from "lucide-react";

export function StockroomWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      {visible && <WalletDialog close={() => setVisible(false)} />}
    </WalletModalContext.Provider>
  );
}

function WalletDialog({ close }: { close: () => void }) {
  const { wallets, select, wallet: selected } = useWallet();
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const installed = wallets.filter(
    (wallet) => wallet.readyState === "Installed",
  );
  const other = wallets.filter(
    (wallet) =>
      wallet.readyState !== "Installed" && wallet.readyState !== "Unsupported",
  );
  const listed = installed.length ? installed : other;
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
  function walletRow(wallet: (typeof wallets)[number]) {
    return (
      <li key={wallet.adapter.name}>
        <button
          className="wallet-choice"
          onClick={() => {
            select(wallet.adapter.name);
            close();
          }}
        >
          {/* Wallet Standard supplies the wallet's own name and icon. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={wallet.adapter.icon} alt="" width={36} height={36} />
          <span>{wallet.adapter.name}</span>
          {wallet.readyState === "Installed" && (
            <small>
              <i />
              Detected
            </small>
          )}
          {selected?.adapter.name === wallet.adapter.name &&
          selected.adapter.connected ? (
            <small>Connected</small>
          ) : (
            <ArrowUpRight size={15} />
          )}
        </button>
      </li>
    );
  }
  return (
    <dialog
      ref={ref}
      className="stockroom-wallet-dialog"
      aria-labelledby="stockroom-wallet-title"
      aria-describedby="stockroom-wallet-description"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <header>
        <span className="wallet-dialog-symbol">
          <Wallet size={20} />
        </span>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close wallet connection"
        >
          <X size={19} />
        </button>
      </header>
      <h2 id="stockroom-wallet-title">Connect wallet</h2>
      <p id="stockroom-wallet-description">Choose your Solana wallet.</p>
      {listed.length ? (
        <ul className="wallet-choices">{listed.map(walletRow)}</ul>
      ) : (
        <div className="wallet-not-found">
          <Wallet size={23} />
          <strong>No wallets detected</strong>
          <span>
            Enable a Solana wallet extension or open Stockroom in your wallet’s
            browser.
          </span>
        </div>
      )}
      {!!installed.length && !!other.length && (
        <>
          <button
            className="wallet-more"
            aria-expanded={expanded}
            aria-controls="other-stockroom-wallets"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Fewer wallets" : "More wallets"}
            <ChevronDown size={14} />
          </button>
          {expanded && (
            <ul id="other-stockroom-wallets" className="wallet-choices">
              {other.map(walletRow)}
            </ul>
          )}
        </>
      )}
      <footer>
        <span className="wallet-network-dot" />
        Solana<span>Connecting won’t move funds</span>
      </footer>
    </dialog>
  );
}
