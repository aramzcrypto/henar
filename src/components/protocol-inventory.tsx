"use client";
import { PackDelivery } from "./pack-delivery";
import { useProtocol } from "./protocol-provider";
import { formatUnits } from "@/lib/amount";
import { canReserveLucky } from "@/lib/lucky";
import type { OpeningMode } from "./lucky-mode";
export function ProtocolInventory({
  openingMode = "random",
}: {
  openingMode?: OpeningMode;
}) {
  const { data, run, busy } = useProtocol();
  if (!data) return null;
  const batches = data.batches.filter((b) => BigInt(b.remaining) > 0n);
  return (
    <div className="protocol-inventory">
      {batches.length === 0 && <p>No sealed packs yet.</p>}
      {batches.map((b) => {
        const lucky = openingMode === "lucky" && !("earned" in b.source);
        const pool = data.luckyPool;
        const canOpen =
          !!data.packExecution?.enabled &&
          (!lucky ||
            (!!pool?.enabled &&
              canReserveLucky(
                10_000_000n - BigInt(b.unitFee),
                BigInt(pool.reserve),
                BigInt(pool.maxStake),
              )));
        return (
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
              disabled={busy || data.paused || !canOpen}
              title={
                !canOpen
                  ? "Pack execution or the Lucky reserve is unavailable. Your sealed pack remains refundable."
                  : undefined
              }
              onClick={() =>
                run({
                  action: lucky ? "openLucky" : "open",
                  account: b.address,
                })
              }
            >
              {lucky ? "Unpack · Lucky" : "Unpack"}
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
        );
      })}
      {data.packs.length > 0 && (
        <p className="protocol-inventory-label">Opened packs &amp; deliveries</p>
      )}
      {data.packs.map((p) => {
        const complete = "settled" in p.status;
        const ready = "luckyReady" in p.status;
        const pool = data.luckyPool;
        const canRoll =
          ready &&
          p.round === 1 &&
          !!pool?.enabled &&
          canReserveLucky(
            BigInt(p.budget ?? "0"),
            BigInt(pool.reserve),
            BigInt(pool.maxStake),
          );
        return (
          <div
            className="protocol-inventory-row pack-inventory-item"
            key={p.address}
          >
            {complete || (!("refunded" in p.status) && !ready) ? (
              <PackDelivery pack={p} />
            ) : (
              <div>
                <strong>
                  {ready
                    ? `${formatUnits(BigInt(p.budget ?? "0"), 6)} USDC · Lucky allocation`
                    : "Refunded"}
                </strong>
                <small>
                  {ready
                    ? `Lucky · Round ${p.round} of 2 · Allocation held in USDC until banked`
                    : `${p.address.slice(0, 8)}`}
                </small>
              </div>
            )}
            {ready ? (
              <div className="lucky-result-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run({ action: "bankLucky", account: p.address })
                  }
                >
                  Bank into stocks
                </button>
                {p.round === 1 && (
                  <button
                    className="secondary"
                    disabled={busy || !canRoll}
                    title={
                      !canRoll
                        ? "Rollover unavailable; Bank remains available."
                        : undefined
                    }
                    onClick={() =>
                      run({ action: "rollLucky", account: p.address })
                    }
                  >
                    Roll over
                  </button>
                )}
                {p.round === 1 && (
                  <small>
                    Another roll risks this allocation:{" "}
                    {formatUnits(BigInt(p.budget ?? "0") / 4n, 6)}–
                    {formatUnits(BigInt(p.budget ?? "0") * 2n, 6)} USDC.
                  </small>
                )}
              </div>
            ) : !complete &&
              !("refunded" in p.status) &&
              Number(p.expiresAt) * 1000 < Date.now() ? (
              <div className="lucky-result-actions">
                {p.lucky && "pending" in p.status && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      run({ action: "resolveLucky", account: p.address })
                    }
                  >
                    Check outcome
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run({
                      action: p.lucky ? "refundLucky" : "refundPack",
                      account: p.address,
                    })
                  }
                >
                  {p.lucky ? "Recover USDC" : "Refund"}
                </button>
                {p.lucky && "pending" in p.status && (
                  <small>
                    Recovery is available only if randomness is still
                    unfulfilled.
                  </small>
                )}
              </div>
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
