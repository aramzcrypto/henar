"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Check, Copy, Gift, LockKeyhole, X } from "lucide-react";
import { REFERRAL_PACK_USDC, REFERRAL_SHARE_PERCENT } from "@/lib/referrals";

export function RewardsMenu() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [origin, setOrigin] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const owner = publicKey?.toBase58();
  const link = owner && origin ? `${origin}/?ref=${owner}` : "";

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [owner]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() {
    setOpen(false);
    setPinned(false);
  }

  return (
    <div
      className="rewards-menu"
      ref={root}
      onPointerEnter={(event) => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current);
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !pinned) {
          leaveTimer.current = setTimeout(() => {
            if (!root.current?.contains(document.activeElement)) setOpen(false);
          }, 180);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`rewards-trigger${open ? " is-open" : ""}`}
        aria-label="Rewards"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!pinned);
          setPinned(!pinned);
        }}
      >
        <Gift size={20} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {open && (
        <section id={id} className="rewards-panel" aria-label="Rewards">
          <div className="rewards-heading">
            <h2>Referrals</h2>
            <button
              type="button"
              className="rewards-close"
              aria-label="Close rewards"
              onClick={() => {
                close();
                trigger.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          </div>
          <p className="rewards-explainer">
            Planned: {REFERRAL_SHARE_PERCENT}% of Henar’s referral trading fees.
          </p>
          <div className="rewards-status">
            <LockKeyhole size={13} aria-hidden="true" /> Rewards coming soon
          </div>
          <div className="rewards-progress">
            <span>Sealed Random pack</span>
            <span>— / ${REFERRAL_PACK_USDC}</span>
          </div>
          <div
            className="rewards-progress-track"
            aria-label="Pack progress unavailable until launch"
          />
          <div
            className="rewards-stats"
            aria-label="Referral statistics unavailable until launch"
          >
            <div>
              <span>Referrals</span>
              <strong aria-label="Not available">—</strong>
            </div>
            <div>
              <span>Earned</span>
              <strong aria-label="Not available">—</strong>
            </div>
            <div>
              <span>Packs</span>
              <strong aria-label="Not available">—</strong>
            </div>
          </div>
          {owner ? (
            <div className="rewards-share">
              <label htmlFor={`${id}-link`}>Invite link</label>
              <div className="rewards-link-row">
                <input
                  id={`${id}-link`}
                  value={link}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  disabled={!link}
                  aria-label={
                    copied ? "Invite link copied" : "Copy invite link"
                  }
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                      setCopyError(false);
                    } catch {
                      setCopyError(true);
                    }
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <span className="rewards-share-note" role="status">
                {copyError
                  ? "Select and copy the link above."
                  : copied
                    ? "Copied."
                    : ""}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="rewards-connect"
              onClick={() => {
                close();
                setVisible(true);
              }}
            >
              Connect wallet
            </button>
          )}
        </section>
      )}
    </div>
  );
}
