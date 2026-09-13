import { BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  type AddressLookupTableAccount,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import idl from "@/data/stockroom-idl.json";
import { USDC } from "./registry";
export type ProtocolIntent = {
  action: string;
  account?: string;
  amount?: string;
  count?: string;
  recipient?: string;
  message?: string;
  kind?: string;
  destination?: string;
  autoPacks?: boolean;
  stockIndex?: number;
  targetPrice?: string;
  steps?: number;
  interval?: number;
  expiresAt?: string;
};
const coder = new BorshInstructionCoder(idl as Idl);
const fail = () => {
  throw new Error(
    "Transaction does not match your requested action. Nothing was signed.",
  );
};
const names: Record<string, string> = {
  withdraw: "withdraw_principal",
  cancel: "cancel_order",
  claim: "claim_yield",
  preferences: "set_preferences",
  buy: "buy_batch",
  gift: "gift_batch",
  refundBatch: "refund_batch",
  open: "open_pack",
  refundPack: "refund_pack",
  yieldBatch: "yield_batch",
  openLucky: "open_lucky",
  bankLucky: "bank_lucky",
  rollLucky: "roll_lucky",
  refundLucky: "refund_lucky",
  resolveLucky: "resolve_lucky",
};
export function validateProtocolTransaction(
  tx: VersionedTransaction,
  owner: string,
  intent: ProtocolIntent,
  tables: AddressLookupTableAccount[],
) {
  if (
    tx.message.header.numRequiredSignatures !== 1 ||
    tx.message.staticAccountKeys[0].toBase58() !== owner ||
    tx.signatures.some((s) => s.some((b) => b !== 0))
  )
    fail();
  const decoded = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: tables,
  });
  const instructions = decoded.instructions;
  const budgets = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  ];
  for (let i = 0; i < 2; i++)
    if (
      !instructions[i]?.programId.equals(budgets[i].programId) ||
      !instructions[i].data.equals(budgets[i].data) ||
      instructions[i].keys.length
    )
      fail();
  // User actions have one fixed-USDC ATA setup followed by exactly one Henar instruction.
  if (instructions.length !== 4) fail();
  const setup = instructions[2],
    a = setup.keys,
    ownerKey = new PublicKey(owner),
    mint = new PublicKey(USDC);
  if (
    !setup.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) ||
    setup.data.length !== 1 ||
    setup.data[0] !== 1 ||
    a.length !== 6 ||
    !a[0].pubkey.equals(ownerKey) ||
    !a[1].pubkey.equals(getAssociatedTokenAddressSync(mint, ownerKey)) ||
    !a[2].pubkey.equals(ownerKey) ||
    !a[3].pubkey.equals(mint) ||
    !a[4].pubkey.equals(SystemProgram.programId) ||
    !a[5].pubkey.equals(TOKEN_PROGRAM_ID)
  )
    fail();
  const ix = instructions[3];
  if (ix.programId.toBase58() !== idl.address) fail();
  const value = coder.decode(ix.data);
  const expectedName =
    intent.action === "deposit"
      ? intent.account
        ? "deposit_more"
        : "create_position"
      : names[intent.action];
  if (!value || value.name !== expectedName) fail();
  const args = value!.data as Record<string, unknown>;
  const text = (v: unknown) => String(v);
  if (
    ["deposit", "withdraw", "claim"].includes(intent.action) &&
    text(args.amount) !== (intent.amount ?? "0")
  )
    fail();
  if (
    ["buy", "gift", "refundBatch"].includes(intent.action) &&
    text(args.count) !== (intent.count ?? "1")
  )
    fail();
  if (
    intent.action === "gift" &&
    (text(args.recipient) !== intent.recipient ||
      args.message !== (intent.message ?? ""))
  )
    fail();
  const definition = idl.instructions.find((i) => i.name === value!.name)!;
  type Account = { name: string; accounts?: Account[] };
  const flatten = (items: Account[]): string[] =>
    items.flatMap((i) => (i.accounts ? flatten(i.accounts) : [i.name]));
  const accountNames = flatten(definition.accounts as Account[]);
  if (intent.account) {
    const field = [
      "deposit",
      "withdraw",
      "cancel",
      "claim",
      "preferences",
      "yieldBatch",
    ].includes(intent.action)
      ? "position"
      : ["gift", "refundBatch", "open", "openLucky"].includes(intent.action)
        ? "batch"
        : "pack";
    const index = accountNames.indexOf(field);
    if (index < 0 || ix.keys[index]?.pubkey.toBase58() !== intent.account)
      fail();
  }
  if (expectedName === "create_position" || intent.action === "preferences") {
    const terms = (
      expectedName === "create_position" ? args.terms : args
    ) as Record<string, unknown>;
    if (
      intent.action !== "preferences" &&
      Object.keys(terms.kind as object)[0].toLowerCase() !==
        (intent.kind ?? "earn")
    )
      fail();
    if (
      Object.keys(terms.destination as object)[0].toLowerCase() !==
        (intent.destination ?? "packs") ||
      terms.auto_packs !== (intent.autoPacks ?? true)
    )
      fail();
    if (
      intent.stockIndex !== undefined &&
      terms.stock_index !== intent.stockIndex
    )
      fail();
    if (expectedName === "create_position") {
      if (
        text(terms.target_price) !== (intent.targetPrice ?? "0") ||
        terms.steps !== (intent.steps ?? 12) ||
        terms.interval_seconds !== (intent.interval ?? 86400) ||
        Number(terms.slippage_bps) > 100
      )
        fail();
      if (intent.expiresAt && text(terms.expires_at) !== intent.expiresAt)
        fail();
    }
  }
}
