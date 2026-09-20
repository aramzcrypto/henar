import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { protocolContext } from "@/lib/protocol/context";
import { displayStockUnits } from "@/lib/protocol/pricing";
import { jsonAccount, pda, ata } from "@/lib/protocol/client";
import { createReadCache } from "@/lib/read-cache";
import { consumePublicQuoteBudget } from "@/lib/equities/rate-limit";
import { principalTvl } from "@/lib/protocol/display";
export const dynamic = "force-dynamic";
const readCache = createReadCache<unknown>(10000);
const tvlCache = createReadCache<string>(15000, 1);
export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner") ?? "";
  /* `fresh=1` skipped the read cache, the TVL cache and the CDN all at once,
     and each miss runs several getProgramAccounts scans against the RPC plan
     the trading paths share. Rotating the owner defeated the per-key
     coalescing too, so one caller could keep every layer cold. Nothing in the
     product asks for it — it is a diagnostic — so it now costs a budget slot
     like every other unauthenticated read. */
  const fresh = url.searchParams.get("fresh") === "1" && consumePublicQuoteBudget(request);
  try {
    if (owner) new PublicKey(owner);
    const value = await readCache(
      owner,
      async () => {
        const response = await readProtocol(request);
        if (!response.ok) throw new Error("Protocol read failed");
        return response.json();
      },
      fresh,
    );
    return NextResponse.json(value, {
      headers: {
        "Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": fresh
          ? "no-store"
          : "public, max-age=10, stale-while-revalidate=10",
      },
    });
  } catch {
    return NextResponse.json(
      {
        available: false,
        error: "Unable to refresh the mainnet connection. Please retry.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "3" },
      },
    );
  }
}
async function readProtocol(request: Request) {
  try {
    const ctx = await protocolContext();
    const { client, config, configKey, programId } = ctx;
    const poolKey = pda(programId, "lucky-pool");
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const [pool, execution, tvl] = await Promise.all([
      client.account.luckyPool.fetchNullable(poolKey),
      client.account.packExecution.fetchNullable(
        pda(programId, "pack-execution"),
      ),
      tvlCache(
        configKey.toBase58(),
        async () =>
          principalTvl(
            (
              await client.account.position.all([
                {
                  memcmp: { offset: 40, bytes: configKey.toBase58() },
                },
              ])
            ).map((position) => position.account),
          ),
        fresh,
      ),
    ]);
    const luckyPool = pool
      ? {
          enabled:
            pool.enabled &&
            !config.paused &&
            (config.enabledProducts & 48) === 48,
          reserve: (await ctx.c.getTokenAccountBalance(ata(poolKey))).value
            .amount,
          maxStake: pool.maxStake.toString(),
          address: poolKey.toBase58(),
        }
      : undefined;
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
    let apy: number | null = null;
    try {
      const res = await fetch(
        `https://api.kamino.finance/kvaults/vaults/${config.vault}/metrics`,
        { cache: "no-store", signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const m = z
          .object({
            apyActual: z.coerce.number().finite(),
          })
          .parse(await res.json());
        apy = m.apyActual * 100;
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
        luckyPool,
        packExecution: execution
          ? {
              enabled:
                execution.enabled &&
                !config.paused &&
                (config.enabledProducts & 16) === 16,
              authority: execution.authority.toBase58(),
              maxBudget: execution.maxBudget.toString(),
            }
          : undefined,
        paused: config.paused,
        access: {
          walletAllowed:
            !owner ||
            config.pilotOwner.equals(PublicKey.default) ||
            config.pilotOwner.equals(owner),
          enabledProducts: config.enabledProducts,
          pilotOwner: config.pilotOwner.toBase58(),
          admissionLimit: config.admissionLimit.toString(),
          admittedUsdc: config.admittedUsdc.toString(),
        },
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
