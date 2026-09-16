/**
 * Solana enrichment for private-market mints, through the same mint
 * inspection the Henar Router uses. Provider metadata never defines token
 * semantics; the mint account does.
 */
import { PublicKey } from "@solana/web3.js";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getExtensionData, unpackMint } from "@solana/spl-token";
import { inspectionFromAccount } from "@henar/router-core";
import { assertMainnet, connection } from "@/lib/solana";
import { createReadCache } from "@/lib/read-cache";
import { provenance, SOURCES } from "@/lib/provenance";
import type { OnchainState } from "./types";

const CACHE_MS = 10 * 60_000;
const cache = createReadCache<Record<string, OnchainState>>(CACHE_MS, 8);

function unavailable(mint: string, error: string, readAt: string): OnchainState {
  return {
    status: "unavailable", mint, tokenProgram: null, isToken2022: null, decimals: null, supplyRaw: null, supplyUi: null, mintAuthority: null, freezeAuthority: null, extensions: [],
    transferFeeBps: null, transferHookProgram: null, permanentDelegate: null, scaledUiMultiplier: null, paused: null, routerSupported: null, unsupportedReason: null, metadataUri: null, slot: null, readAt: null, error,
    provenance: provenance({ ...SOURCES.onchain, observedAt: readAt }),
  };
}

/**
 * The metadata URI a Token-2022 mint publishes about itself.
 *
 * Layout (TokenMetadata extension): updateAuthority(32) mint(32) then
 * length-prefixed name, symbol and uri. Read rather than guessed, so a
 * provider's own artwork is used only where the mint points at it.
 */
export function metadataUriFromAccount(account: { owner: PublicKey; data: Buffer }): string | null {
  if (!account.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  try {
    const unpacked = unpackMint(PublicKey.default, { ...account, executable: false, lamports: 1, rentEpoch: 0 }, TOKEN_2022_PROGRAM_ID);
    const data = getExtensionData(ExtensionType.TokenMetadata, unpacked.tlvData);
    if (!data || data.length < 68) return null;
    let offset = 64;
    for (let field = 0; field < 3; field++) {
      if (offset + 4 > data.length) return null;
      const length = data.readUInt32LE(offset);
      offset += 4;
      if (offset + length > data.length) return null;
      if (field === 2) return data.subarray(offset, offset + length).toString("utf8");
      offset += length;
    }
    return null;
  } catch {
    return null;
  }
}

/** Display supply: raw / 10^decimals, times the scaled-UI multiplier when present. */
export function displaySupply(raw: bigint, decimals: number, multiplier: string | null) {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const base = `${whole}${frac ? `.${frac}` : ""}`;
  if (!multiplier || multiplier === "1") return base;
  const m = Number(multiplier);
  if (!Number.isFinite(m)) return base;
  /* The multiplier is an f64 on chain; the product is a display figure, so it
     is rounded to the mint's own decimals rather than to an arbitrary width. */
  return (Number(base) * m).toLocaleString("en-US", { maximumFractionDigits: decimals, useGrouping: false });
}

/** Pure: an account → OnchainState. */
export function onchainStateFromAccount(mint: string, account: { owner: PublicKey; data: Buffer; executable: boolean; lamports: number; rentEpoch?: number }, slot: number | null, readAt: string): OnchainState {
  const inspection = inspectionFromAccount(mint, account, readAt);
  let mintAuthority: string | null = null;
  let freezeAuthority: string | null = null;
  let supplyRaw: bigint | null = null;
  try {
    const program = account.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const unpacked = unpackMint(new PublicKey(mint), account, program);
    mintAuthority = unpacked.mintAuthority?.toBase58() ?? null;
    freezeAuthority = unpacked.freezeAuthority?.toBase58() ?? null;
    supplyRaw = unpacked.supply;
  } catch {
    // Facts the inspection already captured stand; authorities stay unknown.
  }
  const paused = inspection.extensions.includes("PausableConfig") ? /paused/.test(inspection.unsupportedReason ?? "") : null;
  const metadataUri = metadataUriFromAccount(account);
  return {
    status: "verified",
    mint,
    tokenProgram: inspection.program,
    isToken2022: inspection.isToken2022,
    decimals: inspection.decimals,
    supplyRaw: supplyRaw === null ? null : supplyRaw.toString(),
    supplyUi: supplyRaw === null ? null : displaySupply(supplyRaw, inspection.decimals, inspection.scaledUiMultiplier),
    mintAuthority,
    freezeAuthority,
    extensions: inspection.extensions,
    transferFeeBps: inspection.transferFeeBps,
    transferHookProgram: inspection.transferHookProgram,
    permanentDelegate: inspection.permanentDelegate,
    scaledUiMultiplier: inspection.scaledUiMultiplier,
    paused,
    routerSupported: inspection.supported,
    unsupportedReason: inspection.unsupportedReason,
    metadataUri,
    slot,
    readAt,
    error: null,
    provenance: provenance({ ...SOURCES.onchain, observedAt: readAt, freshness: "fresh" }),
  };
}

export async function onchainStates(mints: string[]): Promise<Record<string, OnchainState>> {
  const key = [...new Set(mints)].sort().join(",");
  if (!key) return {};
  return cache(key, async () => {
    const readAt = new Date().toISOString();
    const list = key.split(",");
    let c;
    try {
      c = connection();
      await assertMainnet(c);
    } catch (error) {
      return Object.fromEntries(list.map((m) => [m, unavailable(m, (error as Error).message, readAt)]));
    }
    const [slot, infos] = await Promise.all([c.getSlot("confirmed"), c.getMultipleAccountsInfo(list.map((m) => new PublicKey(m)), "confirmed")]);
    return Object.fromEntries(
      list.map((mint, i) => {
        const info = infos[i];
        if (!info) return [mint, unavailable(mint, "mint account not found", readAt)];
        try {
          return [mint, onchainStateFromAccount(mint, info, slot, readAt)];
        } catch (error) {
          return [mint, unavailable(mint, (error as Error).message, readAt)];
        }
      }),
    );
  });
}
