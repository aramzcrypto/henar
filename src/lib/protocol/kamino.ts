import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { VaultState } from "@kamino-finance/klend-sdk/dist/@codegen/kvault/accounts/VaultState";
import { Reserve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve";
import { ata, USDC_KEY } from "./client";
export const KVAULT = new PublicKey(
  "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd",
);
export const KLEND = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
);
const key = (s: string) => new PublicKey(s);
const meta = (pubkey: PublicKey, isWritable = false): AccountMeta => ({
  pubkey,
  isWritable,
  isSigner: false,
});
const event = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  KVAULT,
)[0];
export async function vaultState(c: Connection, vault: PublicKey) {
  const account = await c.getAccountInfo(vault);
  if (!account?.owner.equals(KVAULT))
    throw new Error("Unsupported yield vault.");
  const state = VaultState.decode(account.data);
  if (
    state.tokenMint !== USDC_KEY.toBase58() ||
    state.tokenProgram !== TOKEN_PROGRAM_ID.toBase58()
  )
    throw new Error("The yield vault must hold Solana USDC.");
  return state;
}
/** Fixed published Kamino account order; only canonical PDA authority is signed by Stockroom. */
export async function vaultAccounts(
  c: Connection,
  vault: PublicKey,
  position: PublicKey,
) {
  const v = await vaultState(c, vault);
  const allocations = v.vaultAllocationStrategy.filter(
    (a) => a.reserve !== PublicKey.default.toBase58(),
  );
  const infos = allocations.length
    ? await c.getMultipleAccountsInfo(allocations.map((a) => key(a.reserve)))
    : [];
  const reserves = infos.map((a) => {
    if (!a?.owner.equals(KLEND)) throw new Error("Invalid lending reserve.");
    return Reserve.decode(a.data);
  });
  const remaining = [
    ...allocations.map((a) => meta(key(a.reserve), true)),
    ...reserves.map((r) => meta(key(r.lendingMarket))),
  ];
  const sharesMint = key(v.sharesMint),
    cash = ata(position),
    shares = ata(position, sharesMint);
  const deposit = [
    meta(position, true),
    meta(vault, true),
    meta(key(v.tokenVault), true),
    meta(USDC_KEY),
    meta(key(v.baseVaultAuthority)),
    meta(sharesMint, true),
    meta(cash, true),
    meta(shares, true),
    meta(KLEND),
    meta(TOKEN_PROGRAM_ID),
    meta(TOKEN_PROGRAM_ID),
    meta(event),
    meta(KVAULT),
    ...remaining,
  ];
  // Largest allocation first; subsequent groups redeem any tracked shares left over.
  const candidates = allocations
    .map((a, i) => ({ a, r: reserves[i] }))
    .sort((x, y) => y.a.ctokenAllocation.cmp(x.a.ctokenAllocation));
  const optional = KVAULT;
  const withdrawGroups = (candidates.length ? candidates : [undefined]).map(
    (selected) => {
      const r = selected?.r;
      return [
        meta(position, true),
        meta(vault, true),
        meta(
          PublicKey.findProgramAddressSync(
            [Buffer.from("global_config")],
            KVAULT,
          )[0],
        ),
        meta(key(v.tokenVault), true),
        meta(key(v.baseVaultAuthority)),
        meta(cash, true),
        meta(USDC_KEY, true),
        meta(shares, true),
        meta(sharesMint, true),
        meta(TOKEN_PROGRAM_ID),
        meta(TOKEN_PROGRAM_ID),
        meta(KLEND),
        meta(event),
        meta(KVAULT),
        meta(vault, true),
        meta(selected ? key(selected.a.reserve) : optional, true),
        meta(selected ? key(selected.a.ctokenVault) : optional, true),
        meta(r ? key(r.lendingMarket) : optional),
        meta(
          r
            ? PublicKey.findProgramAddressSync(
                [Buffer.from("lma"), key(r.lendingMarket).toBuffer()],
                KLEND,
              )[0]
            : optional,
        ),
        meta(r ? key(r.liquidity.supplyVault) : optional, true),
        meta(r ? key(r.collateral.mintPubkey) : optional, true),
        meta(TOKEN_PROGRAM_ID),
        meta(SYSVAR_INSTRUCTIONS_PUBKEY),
        meta(event),
        meta(KVAULT),
        ...remaining,
      ];
    },
  );
  const withdraw = withdrawGroups.flat();
  return {
    state: v,
    deposit,
    withdraw,
    withdrawGroups,
    lookupTable: key(v.vaultLookupTable),
  };
}
export function conservativeShares(
  v: VaultState,
  amount: bigint,
  slippageBps = 50,
) {
  const shares = BigInt(v.sharesIssued.toString()),
    aum = BigInt(v.prevAumSf.toString()) >> 60n;
  const fee =
    BigInt(v.crankFundFeePerReserve.toString()) *
    BigInt(
      v.vaultAllocationStrategy.filter(
        (a) => a.reserve !== PublicKey.default.toBase58(),
      ).length,
    );
  if (amount <= fee)
    throw new Error("Deposit is below the vault's operating cost.");
  const estimate =
    shares === 0n ? amount - fee : ((amount - fee) * shares) / (aum || 1n);
  const min = (estimate * BigInt(10000 - slippageBps)) / 10000n;
  if (min === 0n) throw new Error("Deposit is too small.");
  return min;
}
