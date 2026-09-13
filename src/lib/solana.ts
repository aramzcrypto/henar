import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
let sharedConnection: Connection | undefined;
export function connection() {
  if (!process.env.SOLANA_RPC_URL)
    throw new Error("Mainnet connection is not configured.");
  if (
    !sharedConnection ||
    sharedConnection.rpcEndpoint !== process.env.SOLANA_RPC_URL
  )
    sharedConnection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
  return sharedConnection;
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
const genesisChecks = new WeakMap<
  Connection,
  { until: number; pending: Promise<void> }
>();
export async function assertMainnet(c: Connection) {
  const current = genesisChecks.get(c);
  if (current && current.until > Date.now()) return current.pending;
  const pending = c
    .getGenesisHash()
    .then((hash) => {
      if (hash !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")
        throw new Error("A Solana mainnet RPC is required.");
    })
    .catch((error) => {
      genesisChecks.delete(c);
      throw error;
    });
  genesisChecks.set(c, { until: Date.now() + 60_000, pending });
  return pending;
}
