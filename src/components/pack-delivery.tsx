"use client";
import Image from "next/image";
import Link from "next/link";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PackView } from "@/lib/protocol/view";
import { stocks } from "@/lib/registry";
import { formatUnits } from "@/lib/amount";
import { StockLogo } from "./stock-logo";
export function PackDelivery({ pack }: { pack: PackView }) {
  const complete = "settled" in pack.status;
  const [kept, setKept] = useState(false);
  const stock = complete
    ? stocks.find((s) => s.mint === pack.stockMint)
    : undefined;
  const expired = Number(pack.expiresAt) * 1000 <= Date.now();
  return (
    <div
      className={`pack-delivery ${complete ? "delivered" : ""}`}
      aria-live="polite"
    >
      {/* The backpack renders at 120px here; unoptimized it pulled the whole
          2.3 MB plate to do it. */}
      <div className="pack-delivery-art" aria-hidden="true">
        {complete && stock ? (
          <StockLogo stock={stock} />
        ) : (
          <Image
            src="/art/backpack-closed.png"
            alt=""
            width={120}
            height={120}
            sizes="120px"
          />
        )}
      </div>
      <div className="pack-delivery-body">
        <span className="pack-delivery-status">
          {complete ? (
            <>
              <Check size={14} /> Delivered to your wallet
            </>
          ) : (
            <>
              <LoaderCircle
                size={14}
                className={expired ? "" : "pack-progress-spin"}
              />{" "}
              {expired
                ? "Delivery delayed"
                : "pending" in pack.status
                  ? "Selecting your stock"
                  : "Buying and delivering"}
            </>
          )}
        </span>
        <strong>
          {complete ? (stock?.name ?? "Stock received") : "Stock Pack"}
        </strong>
        {complete ? (
          <>
            <span>
              {pack.displayUnits ?? "—"} {stock?.ticker ?? "units"}
            </span>
            <small>
              {formatUnits(BigInt(pack.stockValue), 6)} USDC swapped ·{" "}
              {"earned" in pack.source ? "Earned" : "Purchased"}
              {pack.lucky ? " · Lucky" : ""}
            </small>
          </>
        ) : (
          <small>
            {expired
              ? "Your unspent allocation remains recoverable below."
              : "The reveal follows confirmed delivery. You can leave this page."}
          </small>
        )}
        {complete && (
          <div className="pack-delivery-actions">
            <button
              className="secondary"
              onClick={() => setKept(true)}
              disabled={kept}
            >
              {kept ? "In your wallet" : "Keep"}
            </button>
            {stock && (
              <Link className="secondary" href={`/trade?stock=${stock.mint}`}>
                Trade
              </Link>
            )}
          </div>
        )}
        <a
          className="pack-delivery-proof"
          href={`https://solscan.io/account/${pack.address}`}
          target="_blank"
          rel="noreferrer"
        >
          <ShieldCheck size={12} /> Onchain receipt ↗
        </a>
      </div>
    </div>
  );
}
