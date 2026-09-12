import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import {
  Connection,
  PublicKey,
  Keypair,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import { assertMainnet } from "../src/lib/solana";
import { ata, pda } from "../src/lib/protocol/client";
import { vaultAccounts } from "../src/lib/protocol/kamino";
import { protocolLookupAddresses } from "../src/lib/protocol/lookup";
import { safeError } from "../src/lib/protocol/errors";
import { Dispatcher } from "../services/solver/transactions";
import manifest from "../config/mainnet-manifest.json";
async function main() {
  const c = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  await assertMainnet(c);
  const publicKeys = JSON.parse(
    await readFile(".secrets/public-addresses.json", "utf8"),
  );
  const id = new PublicKey(process.env.STOCKROOM_PROGRAM_ID!),
    owner = new PublicKey(publicKeys.admin.address),
    solver = new PublicKey(publicKeys.solver.address),
    treasury = new PublicKey(process.env.STOCKROOM_TREASURY_OWNER!);
  const position = pda(id, "position", owner, 1n),
    vault = await vaultAccounts(
      c,
      new PublicKey(process.env.STOCKROOM_VAULT!),
      position,
    );
  const addresses = protocolLookupAddresses(
    id,
    BigInt(manifest.version),
    treasury,
    solver,
    manifest.stocks,
    [...vault.deposit, ...vault.withdraw],
    [
      position,
      ata(position),
      ata(position, new PublicKey(vault.state.sharesMint)),
    ],
  );
  const file = ".secrets/lookup-table.json";
  let saved: { address: string; recentSlot: number } | null = null;
  try {
    saved = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let tableKey = process.env.STOCKROOM_LOOKUP_TABLE
    ? new PublicKey(process.env.STOCKROOM_LOOKUP_TABLE)
    : saved
      ? new PublicKey(saved.address)
      : null;
  let table = tableKey ? (await c.getAddressLookupTable(tableKey)).value : null;
  const missing = addresses.filter(
    (a) => !table?.state.addresses.some((b) => a.equals(b)),
  );
  console.log(
    JSON.stringify({
      mode: process.argv.includes("--execute") ? "execute" : "read-only",
      addresses: addresses.length,
      missing: missing.length,
      table: tableKey?.toBase58() ?? null,
      rentLamports: await c.getMinimumBalanceForRentExemption(
        56 + 32 * addresses.length,
      ),
    }),
  );
  if (!process.argv.includes("--execute")) return;
  const keyfile = process.env.STOCKROOM_ADMIN_KEYPAIR_PATH!;
  if ((await stat(keyfile)).mode & 0o077)
    throw Error("Admin key must have permissions 0600");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(keyfile, "utf8"))),
  );
  if (!signer.publicKey.equals(owner)) throw Error("Admin identity mismatch");
  await mkdir(".secrets", { recursive: true, mode: 0o700 });
  const dispatch = new Dispatcher(c, signer, async (signature, blockhash) => {
    await writeFile(
      ".secrets/lookup-pending.json",
      JSON.stringify({ signature, blockhash }),
      { mode: 0o600 },
    );
    console.log(`Submitted: ${signature}`);
  });
  // Reconcile uncertain submissions before sending any replacement.
  try {
    const pending = JSON.parse(
      await readFile(".secrets/lookup-pending.json", "utf8"),
    );
    const status = (
      await c.getSignatureStatuses([pending.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (
      (!status && (await c.isBlockhashValid(pending.blockhash)).value) ||
      (status &&
        !["confirmed", "finalized"].includes(status.confirmationStatus ?? ""))
    )
      throw Error(
        "Previous lookup-table transaction is unresolved; retry after confirmation or expiry",
      );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (!table) {
    const recentSlot = await c.getSlot("finalized");
    const [ix, created] = AddressLookupTableProgram.createLookupTable({
      authority: owner,
      payer: owner,
      recentSlot,
    });
    tableKey = created;
    await writeFile(
      file,
      JSON.stringify({ address: created.toBase58(), recentSlot }),
      { mode: 0o600 },
    );
    await dispatch.instructions([ix]);
    table = (await c.getAddressLookupTable(created)).value;
  }
  if (!tableKey || !table?.state.authority?.equals(owner) || !table.isActive())
    throw Error(
      "Lookup table must be active and controlled by the local admin",
    );
  const remaining = addresses.filter(
    (a) => !table!.state.addresses.some((b) => a.equals(b)),
  );
  for (let i = 0; i < remaining.length; i += 20)
    await dispatch.instructions([
      AddressLookupTableProgram.extendLookupTable({
        lookupTable: tableKey,
        authority: owner,
        payer: owner,
        addresses: remaining.slice(i, i + 20),
      }),
    ]);
  const verified = (await c.getAddressLookupTable(tableKey)).value;
  if (
    !verified ||
    addresses.some((a) => !verified.state.addresses.some((b) => a.equals(b)))
  )
    throw Error("Lookup table is incomplete");
  const env = await readFile(".env.local", "utf8");
  await writeFile(
    ".env.local",
    env.replace(/^STOCKROOM_LOOKUP_TABLE=.*\n?/gm, "").trimEnd() +
      `\nSTOCKROOM_LOOKUP_TABLE=${tableKey}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Verified lookup table: ${tableKey}. Add this public address to the server and worker environment before building.`,
  );
}
main().catch((e) => {
  console.error(safeError(e, "Lookup-table setup failed"));
  process.exitCode = 1;
});
