"use client";
import Link from "next/link";
import { useProtocol } from "./protocol-provider";
import { formatUnits } from "@/lib/amount";
import { stocks } from "@/lib/registry";
export function ProtocolInventory() {
  const { data, run, busy } = useProtocol();
  if (!data) return null;
  const batches = data.batches.filter((b) => BigInt(b.remaining) > 0n);
  return (
    <div className="protocol-inventory">
      {batches.length === 0 && <p>No sealed packs yet.</p>}
      {batches.map((b) => (
        <div className="protocol-inventory-row" key={b.address}>
          <div>
            <strong>
              {b.remaining} Stock {b.remaining === "1" ? "Pack" : "Packs"}
            </strong>
            <small>
              {"earned" in b.source ? "Earned" : "Purchased"}
              {b.message ? ` · ${b.message}` : ""}
            </small>
          </div>
          <button
            className="secondary"
            disabled={busy || data.paused}
            onClick={() => run({ action: "open", account: b.address })}
          >
            Open one
          </button>
          <button
            className="product-back"
            disabled={busy}
            onClick={() =>
              run({
                action: "refundBatch",
                account: b.address,
                count: b.remaining,
              })
            }
          >
            Refund sealed
          </button>
        </div>
      ))}
      {data.packs.map((p) => {
        const complete = "settled" in p.status;
        const stock = stocks.find((s) => s.mint === p.stockMint);
        return (
          <div className="protocol-inventory-row" key={p.address}>
            <div>
              <strong>
                {complete
                  ? (stock?.name ?? "Stock received")
                  : "refunded" in p.status
                    ? "Refunded"
                    : "selected" in p.status
                      ? "Stock selected · settling"
                      : "Waiting for randomness"}
              </strong>
              <small>
                {complete
                  ? `${formatUnits(BigInt(p.stockValue), 6)} USDC · ${p.displayUnits ?? ""} ${stock?.ticker ?? ""} · ${"earned" in p.source ? "Earned" : "Purchased"}`
                  : p.address.slice(0, 8)}
              </small>
            </div>
            {complete && stock ? (
              <Link className="secondary" href={`/trade?stock=${stock.mint}`}>
                Trade
              </Link>
            ) : !complete &&
              !("refunded" in p.status) &&
              Number(p.expiresAt) * 1000 < Date.now() ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run({ action: "refundPack", account: p.address })
                }
              >
                Refund
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
export function ProtocolPositions({
  earnOnly = false,
}: {
  earnOnly?: boolean;
}) {
  const { data, run, busy } = useProtocol();
  if (!data) return null;
  const positions = data.positions.filter((p) =>
    earnOnly ? "earn" in p.kind : !("earn" in p.kind),
  );
  if (!positions.length) return null;
  return (
    <section
      className="protocol-positions"
      aria-label={earnOnly ? "Your earning positions" : "Your orders"}
    >
      {positions.map((p) => (
        <div className="protocol-inventory-row" key={p.address}>
          <div>
            <strong>
              {"earn" in p.kind
                ? "USDC Earn"
                : "limit" in p.kind
                  ? "Limit order"
                  : "DCA order"}
            </strong>
            <small>
              {formatUnits(BigInt(p.principalBasis), 6)} USDC ·{" "}
              {formatUnits(BigInt(p.claimable), 6)} yield ·{" "}
              {Object.keys(p.status)[0]}
            </small>
          </div>
          {"active" in p.status && !earnOnly && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run({ action: "cancel", account: p.address })}
            >
              Cancel
            </button>
          )}
          {earnOnly &&
            "packs" in p.destination &&
            p.autoPacks &&
            BigInt(p.claimable) >= 10000000n && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run({ action: "yieldBatch", account: p.address })
                }
              >
                Create earned packs
              </button>
            )}
          {BigInt(p.claimable) > 0n && (
            <button
              className="product-back"
              disabled={busy}
              onClick={() =>
                run({
                  action: "claim",
                  account: p.address,
                  amount: p.claimable,
                })
              }
            >
              Claim yield
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
