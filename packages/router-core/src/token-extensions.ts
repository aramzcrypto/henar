/**
 * Mint inspection shared by every direct venue.
 *
 * A mint is read once from chain and reduced to `MintInspection`: which
 * program owns it, its decimals, and which Token-2022 extensions it carries.
 * The adapter then decides support with `supported`/`unsupportedReason`
 * rather than guessing at execution time.
 *
 * Policy (fail closed, extend deliberately):
 *  - legacy Token program: supported;
 *  - Token-2022 with no extensions, or only the ones listed in
 *    SUPPORTED_EXTENSIONS: supported;
 *  - TransferFeeConfig: supported. The fee in basis points is recorded and
 *    the Execution Guard (`transferFee.accounted`) admits a fee-bearing mint
 *    only through venues whose quotes are net of the fee, so every floor is
 *    a net figure. Tessera T-Tokens (20 bps) and PreStocks (50 bps) carry it;
 *  - TransferHook: unsupported (hook programs are arbitrary code);
 *  - PermanentDelegate: supported and recorded. Tokenized equities carry it
 *    as an issuer compliance control (xStocks, Backpack both do); it does
 *    not change swap settlement. The delegate address is exposed so the UI
 *    can disclose it.
 *  - PausableConfig: supported while unpaused; a paused mint is unsupported
 *    because every transfer would fail.
 *  - NonTransferable, DefaultAccountState(frozen): unsupported.
 *  - ScaledUiAmount: supported for quoting; the multiplier is exposed so UI
 *    can display it, and raw amounts remain the settlement unit throughout.
 *
 * `inspectionFromAccount` is pure so tests can feed synthetic mint accounts.
 */
import {
  ExtensionType,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionData,
  getExtensionTypes,
  unpackMint,
  type Mint,
} from "@solana/spl-token";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import type { MintInspection } from "./types";

/** Extension types the router can settle without extra handling. */
export const SUPPORTED_EXTENSIONS = new Set<string>([
  "MetadataPointer",
  "TokenMetadata",
  "MintCloseAuthority",
  "GroupPointer",
  "GroupMemberPointer",
  "TokenGroup",
  "TokenGroupMember",
  "ScaledUiAmountConfig",
  "InterestBearingConfig",
  "ImmutableOwner",
  "PausableConfig",
  "PermanentDelegate",
  "ConfidentialTransferMint",
  // Confidential-transfer fee accounting only touches confidential transfers,
  // which Henar never makes; the extension is inert for a plain swap.
  "ConfidentialTransferFeeConfig",
  "TransferFeeConfig",
]);

/**
 * Extension ids the installed `@solana/spl-token` does not name yet.
 *
 * 16 is the mint-level confidential-transfer fee config: the RPC's own
 * jsonParsed decode of the PreStocks mints names it `confidentialTransferFeeConfig`
 * at the same TLV position this decoder reports as `Unknown(16)`, and 17 is
 * its account-level counterpart, which never appears on a mint. Naming them
 * here is what lets the support policy judge them by name rather than
 * refusing every mint that carries one.
 */
const UNNAMED_EXTENSIONS: Record<number, string> = {
  16: "ConfidentialTransferFeeConfig",
  17: "ConfidentialTransferFeeAmount",
};

const extensionName = (type: ExtensionType) => ExtensionType[type] ?? UNNAMED_EXTENSIONS[type as number] ?? `Unknown(${type})`;

function u16le(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function u64leString(buffer: Buffer, offset: number) {
  return buffer.readBigUInt64LE(offset).toString();
}

function f64le(buffer: Buffer, offset: number) {
  return buffer.readDoubleLE(offset);
}

/**
 * Reduce a raw mint account to the facts the router needs. Pure.
 */
export function inspectionFromAccount(
  mint: string,
  account: AccountInfo<Buffer>,
  readAt = new Date().toISOString(),
): MintInspection {
  const owner = account.owner.toBase58();
  const base: Omit<MintInspection, "decimals" | "supported" | "unsupportedReason"> = {
    mint,
    program: owner,
    isToken2022: owner === TOKEN_2022_PROGRAM_ID.toBase58(),
    extensions: [],
    transferFeeBps: null,
    transferHookProgram: null,
    scaledUiMultiplier: null,
    permanentDelegate: null,
    nonTransferable: false,
    readAt,
  };

  if (owner === TOKEN_PROGRAM_ID.toBase58()) {
    const decoded = MintLayout.decode(account.data);
    return { ...base, decimals: decoded.decimals, supported: true, unsupportedReason: null };
  }

  if (owner !== TOKEN_2022_PROGRAM_ID.toBase58()) {
    return {
      ...base,
      decimals: 0,
      supported: false,
      unsupportedReason: `mint owned by unknown program ${owner}`,
    };
  }

  let unpacked: Mint;
  try {
    unpacked = unpackMint(new PublicKey(mint), account, TOKEN_2022_PROGRAM_ID);
  } catch (error) {
    return {
      ...base,
      decimals: 0,
      supported: false,
      unsupportedReason: `mint account could not be decoded: ${(error as Error).message}`,
    };
  }

  const tlv = unpacked.tlvData;
  const types = tlv.length ? getExtensionTypes(tlv) : [];
  const extensions = types.map(extensionName);
  const problems: string[] = [];

  let transferFeeBps: number | null = null;
  let transferHookProgram: string | null = null;
  let scaledUiMultiplier: string | null = null;
  let permanentDelegate: string | null = null;
  let nonTransferable = false;

  for (const type of types) {
    const name = extensionName(type);
    const data = getExtensionData(type, tlv);
    switch (type) {
      case ExtensionType.TransferFeeConfig: {
        // Layout: authority(32) withdraw(32) withheld(8) older{epoch(8) max(8) bps(2)} newer{…}
        if (data && data.length >= 108) {
          const olderBps = u16le(data, 88);
          const newerBps = u16le(data, 106);
          // The higher of the two schedules is the conservative fee to assume.
          transferFeeBps = Math.max(olderBps, newerBps);
        } else problems.push("transfer fee config unreadable");
        break;
      }
      case ExtensionType.TransferHook: {
        if (data && data.length >= 64) {
          const program = new PublicKey(data.subarray(32, 64));
          transferHookProgram = program.equals(PublicKey.default) ? null : program.toBase58();
        }
        if (transferHookProgram) problems.push(`transfer hook ${transferHookProgram}`);
        break;
      }
      case ExtensionType.PermanentDelegate: {
        if (data && data.length >= 32) {
          const delegate = new PublicKey(data.subarray(0, 32));
          permanentDelegate = delegate.equals(PublicKey.default) ? null : delegate.toBase58();
        }
        // Issuer control, not a settlement obstacle: recorded, not refused.
        break;
      }
      case ExtensionType.NonTransferable:
        nonTransferable = true;
        problems.push("non-transferable");
        break;
      case ExtensionType.DefaultAccountState: {
        // 1 = Initialized, 2 = Frozen
        if (data && data.length >= 1 && data[0] === 2) problems.push("default account state frozen");
        break;
      }
      case ExtensionType.PausableConfig: {
        // authority(32) paused(1)
        if (data && data.length >= 33 && data[32] === 1) problems.push("mint is paused");
        break;
      }
      case ExtensionType.ScaledUiAmountConfig: {
        // authority(32) multiplier f64(8) newMultiplierEffectiveTimestamp i64(8) newMultiplier f64(8)
        if (data && data.length >= 56) {
          const effective = Number(u64leString(data, 40));
          const nowSec = Math.floor(Date.parse(readAt) / 1000);
          const multiplier = effective <= nowSec ? f64le(data, 48) : f64le(data, 32);
          scaledUiMultiplier = Number.isFinite(multiplier) ? String(multiplier) : null;
        }
        break;
      }
      default:
        if (!SUPPORTED_EXTENSIONS.has(name)) problems.push(`unsupported extension ${name}`);
    }
  }

  return {
    ...base,
    decimals: unpacked.decimals,
    extensions,
    transferFeeBps,
    transferHookProgram,
    scaledUiMultiplier,
    permanentDelegate,
    nonTransferable,
    supported: problems.length === 0,
    unsupportedReason: problems.length ? problems.join("; ") : null,
  };
}

export async function inspectMint(connection: Connection, mint: string): Promise<MintInspection | null> {
  const account = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
  if (!account) return null;
  return inspectionFromAccount(mint, account);
}

export async function inspectMints(connection: Connection, mints: string[]) {
  const infos = await connection.getMultipleAccountsInfo(
    mints.map((m) => new PublicKey(m)),
    "confirmed",
  );
  return mints.map((mint, i) => (infos[i] ? inspectionFromAccount(mint, infos[i]!) : null));
}
