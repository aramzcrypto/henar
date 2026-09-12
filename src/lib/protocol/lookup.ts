import { PublicKey, type Connection, type AccountMeta } from "@solana/web3.js";
import { ata, common, pda, USDC_KEY } from "./client";
export function protocolLookupAddresses(
  program: PublicKey,
  version: bigint,
  treasuryOwner: PublicKey,
  solver: PublicKey,
  stocks: { mint: string; tokenProgram: string }[],
  vaultAccounts: AccountMeta[],
  excluded: PublicKey[] = [],
) {
  const omit = new Set(excluded.map((k) => k.toBase58()));
  const keys = [
    program,
    pda(program, "config"),
    pda(program, "manifest", version),
    ...Object.values(common),
    USDC_KEY,
    ata(solver),
    ata(treasuryOwner),
    ...vaultAccounts.map((a) => a.pubkey),
    ...stocks.flatMap((s) => {
      const mint = new PublicKey(s.mint),
        tokenProgram = new PublicKey(s.tokenProgram);
      return [
        mint,
        tokenProgram,
        ata(solver, mint, tokenProgram),
        ata(treasuryOwner, mint, tokenProgram),
      ];
    }),
  ];
  const unique = [
    ...new Map(
      keys.filter((k) => !omit.has(k.toBase58())).map((k) => [k.toBase58(), k]),
    ).values(),
  ];
  if (unique.length > 256)
    throw new Error("Protocol lookup table exceeds 256 addresses");
  return unique;
}
export async function protocolLookupTables(c: Connection) {
  const configured = process.env.STOCKROOM_LOOKUP_TABLE;
  if (!configured) return [];
  const table = (await c.getAddressLookupTable(new PublicKey(configured)))
    .value;
  if (!table || !table.isActive())
    throw new Error("Protocol lookup table is unavailable");
  return [table];
}
