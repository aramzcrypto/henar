import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
export function connection() {
  if (!process.env.SOLANA_RPC_URL)
    throw new Error("Mainnet connection is not configured.");
  return new Connection(process.env.SOLANA_RPC_URL, "confirmed");
}
export async function verifiedMint(c: Connection, mint: string) {
  const key = new PublicKey(mint);
  const info = await c.getAccountInfo(key);
  if (
    !info ||
    ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
      info.owner.toBase58(),
    )
  )
    throw new Error("Stock mint could not be verified onchain.");
  const data = await getMint(c, key, "confirmed", info.owner);
  return { decimals: data.decimals, program: info.owner.toBase58() };
}
export async function assertMainnet(c: Connection) {
  if ((await c.getGenesisHash()) !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")
    throw new Error("A Solana mainnet RPC is required.");
}
