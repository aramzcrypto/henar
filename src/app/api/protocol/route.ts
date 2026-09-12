import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { protocolContext } from "@/lib/protocol/context";
import { displayStockUnits } from "@/lib/protocol/pricing";
import { jsonAccount } from "@/lib/protocol/client";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await protocolContext();
    const { client, config, programId } = ctx;
    const ownerString = new URL(request.url).searchParams.get("owner");
    const owner = ownerString ? new PublicKey(ownerString) : null;
    const [positions, batches, packs] = owner
      ? await Promise.all([
          client.account.position.all([
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
          ]),
          client.account.packBatch.all([
            { memcmp: { offset: 40, bytes: owner.toBase58() } },
          ]),
          client.account.pack.all([
            { memcmp: { offset: 8, bytes: owner.toBase58() } },
          ]),
        ])
      : [[], [], []];
    const manifests = new Map([
      [config.activeManifest.toBase58(), ctx.manifest],
    ]);
    for (const p of [...packs, ...positions]) {
      const key = p.account.manifest.toBase58();
      if (!manifests.has(key))
        manifests.set(
          key,
          await client.account.manifest.fetch(p.account.manifest),
        );
    }
    let apy: number | null = null,
      tvl: string | null = null;
    try {
      const res = await fetch(
        `https://api.kamino.finance/kvaults/vaults/${config.vault}/metrics`,
        { cache: "no-store", signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const m = z
          .object({
            apyActual: z.coerce.number().finite(),
            tokensAvailable: z.string(),
            tokensInvested: z.string(),
          })
          .parse(await res.json());
        apy = m.apyActual * 100;
        const Decimal = (await import("decimal.js")).default;
        tvl = new Decimal(m.tokensAvailable).add(m.tokensInvested).toFixed(6);
      }
    } catch {
      /* Missing upstream metrics remain unavailable; no synthetic rates. */
    }
    const sum = (
      field: "principalBasis" | "grossYield" | "yieldFees" | "claimable",
    ) =>
      positions
        .reduce((n, p) => n + BigInt(p.account[field].toString()), 0n)
        .toString();
    const serialize = (
      items: typeof positions | typeof batches | typeof packs,
    ) =>
      items.map((p) => ({
        address: p.publicKey.toBase58(),
        ...(jsonAccount(p.account) as object),
      }));
    return NextResponse.json(
      {
        available: true,
        paused: config.paused,
        programId: programId.toBase58(),
        vault: config.vault.toBase58(),
        yieldShareBps: config.yieldShareBps,
        packFeeBps: config.packFeeBps,
        tradeFeeBps: config.tradeFeeBps,
        apy,
        tvl,
        stocks: jsonAccount(ctx.manifest.stocks),
        positions: positions.map((p) => ({
          address: p.publicKey.toBase58(),
          ...(jsonAccount(p.account) as object),
          stockMint: manifests
            .get(p.account.manifest.toBase58())
            ?.stocks[p.account.stockIndex]?.mint.toBase58(),
        })),
        batches: serialize(batches),
        packs: packs.map((p) => ({
          address: p.publicKey.toBase58(),
          ...(jsonAccount(p.account) as object),
          stockMint: manifests
            .get(p.account.manifest.toBase58())
            ?.stocks[p.account.stockIndex]?.mint.toBase58(),
          displayUnits:
            "settled" in p.account.status
              ? displayStockUnits(
                  BigInt(p.account.unitsReceived.toString()),
                  BigInt(p.account.uiMultiplierBits.toString()),
                  manifests.get(p.account.manifest.toBase58())!.stocks[
                    p.account.stockIndex
                  ].decimals,
                )
              : undefined,
        })),
        summary: {
          principal: sum("principalBasis"),
          grossYield: sum("grossYield"),
          yieldFees: sum("yieldFees"),
          claimable: sum("claimable"),
          sealed: batches
            .reduce((n, b) => n + BigInt(b.account.remaining.toString()), 0n)
            .toString(),
          activeOrders: positions.filter(
            (p) => !("earn" in p.account.kind) && "active" in p.account.status,
          ).length,
        },
        observedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        error:
          error instanceof Error && error.message.includes("not configured")
            ? error.message
            : "Mainnet protocol data is unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
