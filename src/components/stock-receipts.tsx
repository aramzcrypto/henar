"use client";
import { ArrowUpRight, Box, Sprout } from "lucide-react";
import { useProtocol } from "./protocol-provider";
import { stockReceipts } from "@/lib/stock-receipts";
import { stocks } from "@/lib/registry";
import { formatUnits } from "@/lib/amount";
import { StockLogo } from "./stock-logo";
export function StockReceipts({ owner }: { owner?: string }) {
  const { data, error } = useProtocol();
  if (!owner) return null;
  const receipts = stockReceipts(data, owner).filter(
    (r) => !r.mint || stocks.some((s) => s.mint === r.mint),
  );
  return (
    <section className="stock-receipts">
      <div className="section-heading">
        <h2>From yield &amp; packs</h2>
        <span title="Recorded receipts, including stocks you may have since traded or transferred.">
          Received history
        </span>
      </div>
      {!data || error ? (
        <p className="stock-receipts-empty">
          Yield and pack history is unavailable.
        </p>
      ) : !receipts.length ? (
        <p className="stock-receipts-empty">
          Stocks received from yield and opened packs will appear here.
        </p>
      ) : (
        receipts.map((receipt) => {
          const stock = stocks.find((s) => s.mint === receipt.mint);
          const decimals = data.stocks.find(
            (s) => s.mint === receipt.mint,
          )?.decimals;
          return (
            <div
              className="receipt-row"
              key={`${receipt.source}:${receipt.address}`}
            >
              <span className="asset">
                {stock ? (
                  <StockLogo stock={stock} />
                ) : (
                  <span className="yield-receipt-icon">
                    <Sprout size={22} />
                  </span>
                )}
                <span>
                  <strong>{stock?.name ?? "Yield-funded stocks"}</strong>
                  <small
                    title={
                      stock
                        ? undefined
                        : "Yield fills grouped by position. Its selected stock can change over time."
                    }
                  >
                    {stock?.ticker ??
                      `Position ${receipt.address.slice(0, 6)}…`}
                  </small>
                </span>
              </span>
              <span className="receipt-source">
                {receipt.source === "Yield" ? (
                  <Sprout size={13} />
                ) : (
                  <Box size={13} />
                )}
                {receipt.source}
              </span>
              <span className="receipt-units">
                {receipt.source === "Yield"
                  ? `${formatUnits(receipt.value!, 6)} USDC`
                  : formatUnits(receipt.units!, decimals!)}{" "}
                <small>
                  {receipt.source === "Yield" ? "invested" : "received"}
                </small>
              </span>
              <a
                href={`https://solscan.io/account/${receipt.address}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${stock?.ticker ?? "yield"} receipt`}
              >
                <ArrowUpRight size={16} />
              </a>
            </div>
          );
        })
      )}
    </section>
  );
}
