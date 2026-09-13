import { Connection } from "@solana/web3.js";
import { program } from "@/lib/protocol/client";
import { NextResponse } from "next/server";
import { protocolContext } from "@/lib/protocol/context";
import {
  verifyAdminProof,
  allowedAdminWallets,
  PRIVATE_HEADERS,
} from "@/lib/admin/auth";
import { aggregateAdmin } from "@/lib/admin/aggregate";
import type { AdminSnapshot } from "@/lib/admin/types";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
let cached: { key: string; until: number; value: AdminSnapshot } | undefined;
export async function GET(request: Request) {
  if (
    !request.headers.get("authorization") ||
    request.headers.get("authorization")!.length > 1024
  )
    return NextResponse.json(
      { error: "Admin sign-in required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  try {
    const { config, configKey, programId, c } = await protocolContext();
    if (
      !verifyAdminProof(
        request.headers.get("authorization"),
        new URL(request.url).origin,
        allowedAdminWallets(config.admin.toBase58()),
      )
    )
      return NextResponse.json(
        { error: "Admin session expired or unauthorized." },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    const key = `${programId.toBase58()}:${config.paused}:${config.enabledProducts}:${config.pilotOwner.toBase58()}:${config.admittedUsdc.toString()}:${config.admissionLimit.toString()}`;
    if (cached?.key === key && cached.until > Date.now())
      return NextResponse.json(cached.value, { headers: PRIVATE_HEADERS });
    const client = program(
      new Connection(c.rpcEndpoint, "finalized"),
      programId,
    );
    const filter = (offset: number) => [
      { memcmp: { offset, bytes: configKey.toBase58() } },
    ];
    const [positions, batches, packs, treasuryResult] = await Promise.all([
      client.account.position.all(filter(40)),
      client.account.packBatch.all(filter(72)),
      client.account.pack.all(filter(72)),
      c
        .getTokenAccountBalance(config.treasury, "finalized")
        .then((value) => value.value.amount)
        .catch(() => null),
    ]);
    if (positions.length + batches.length + packs.length > 5000)
      throw new Error("Snapshot limit reached");
    const data = aggregateAdmin(
      positions.map((p) => ({ ...p.account, address: p.publicKey.toBase58() })),
      batches.map((p) => ({ ...p.account, address: p.publicKey.toBase58() })),
      packs.map((p) => ({ ...p.account, address: p.publicKey.toBase58() })),
      config.enabledProducts,
      config.paused,
    );
    const warnings = [
      "Market history, visitors, and verified referrals are not indexed. These are protocol wallets, not unique people.",
      "Recorded yield fees include accruals; they are not reconciled cash revenue. Treasury balance includes funding and withdrawals.",
    ];
    if (treasuryResult === null)
      warnings.push("Treasury balance could not be read.");
    if (data.totals.packFees === null)
      warnings.push(
        "Some Lucky batch records are missing; pack fee totals are incomplete.",
      );
    if (data.totals.overduePacks)
      warnings.push(
        `${data.totals.overduePacks} pack(s) have passed their deadline. Check settlement or recovery status.`,
      );
    const value: AdminSnapshot = {
      ...data,
      observedAt: new Date().toISOString(),
      programId: programId.toBase58(),
      treasury: {
        address: config.treasury.toBase58(),
        balance: treasuryResult,
      },
      access: {
        paused: config.paused,
        enabledProducts: config.enabledProducts,
        pilotOwner: config.pilotOwner.toBase58(),
        admissionLimit: config.admissionLimit.toString(),
        admitted: config.admittedUsdc.toString(),
      },
      warnings,
      coverage:
        "Finalized account records · current retained accounts · excludes Market swaps and website visitors. Separate account reads may reflect different slots.",
    };
    cached = { key, until: Date.now() + 15_000, value };
    return NextResponse.json(value, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Verified admin data is unavailable. Try again shortly." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
