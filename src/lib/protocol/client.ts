import { BN, Program, type IdlAccounts, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import idl from "@/data/stockroom-idl.json";
import type { Stockroom } from "@/data/stockroom";
export const USDC_KEY = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
export const DEVELOPMENT_PROGRAM =
  "8uf1J8kvptnT4Bq84GaQG9zHmgPQgVKz6WWfYpvuA11B";
export type Accounts = IdlAccounts<Stockroom>;
export const integer = (value: string | bigint | number) =>
  new BN(value.toString());
export const address = (value: string | PublicKey) => new PublicKey(value);
export const ata = (
  owner: PublicKey,
  mint = USDC_KEY,
  tokenProgram = TOKEN_PROGRAM_ID,
) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
export const common = {
  usdc: USDC_KEY,
  tokenProgram: TOKEN_PROGRAM_ID,
  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
};
export function program(connection: Connection, programId: PublicKey) {
  return new Program<Stockroom>(
    { ...idl, address: programId.toBase58() } as unknown as Stockroom,
    { connection },
  );
}
export function pda(
  programId: PublicKey,
  name: string,
  ...seeds: (PublicKey | bigint)[]
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(name),
      ...seeds.map((s) =>
        typeof s === "bigint"
          ? integer(s).toArrayLike(Buffer, "le", 8)
          : s.toBuffer(),
      ),
    ],
    programId,
  )[0];
}
export function jsonAccount(value: unknown): unknown {
  if (BN.isBN(value)) return (value as BN).toString(10);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(jsonAccount);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, jsonAccount(v)]),
    );
  return value;
}
export const rawIdl = idl as Idl;
