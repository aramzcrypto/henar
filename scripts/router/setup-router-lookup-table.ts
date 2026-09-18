/**
 * Create and extend the router's address lookup table.
 *
 * Plans by default and writes nothing on chain. `--execute` is required to
 * send, and even then it refuses unless HENAR_LUT_AUTHORIZED=1 is set in the
 * environment, because this spends SOL from the signing key and creates a
 * permanent account. Two gates, deliberately: an accidental `--execute` in a
 * script should not be able to transact.
 *
 * Why the table exists: three-leg routes do not fit in a 1232-byte packet.
 * Measured over real routes, 0 of 9 fitted without a table and 9 of 9 fitted
 * with one, at 530-556 bytes, because a table replaces a 32-byte account key
 * with a 1-byte index. The addresses come from
 * `npm run router:plan:lut`, which records the accounts more than one route
 * touches.
 *
 * After creation, set HENAR_ROUTER_LOOKUP_TABLE to the printed address. The
 * split cap reads that variable and only then opens a third leg, so the table
 * and the cap can never be out of step.
 *
 *   npm run router:lut:plan
 *   HENAR_LUT_AUTHORIZED=1 npm run router:lut:setup -- --execute
 */
import { readFile } from "node:fs/promises";
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";

const PLAN = "docs/router/LOOKUP_TABLE_PLAN.json";
/** Extension instructions are bounded by transaction size, not by the table. */
const ADDRESSES_PER_EXTEND = 20;

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required.");
  const execute = process.argv.includes("--execute");
  const authorized = process.env.HENAR_LUT_AUTHORIZED === "1";

  const plan = JSON.parse(await readFile(PLAN, "utf8")) as { tableAddresses: string[]; rows: { fitsToday: boolean; fitsWithTable: boolean }[] };
  const addresses = plan.tableAddresses.map((a) => new PublicKey(a));
  if (!addresses.length) throw new Error(`${PLAN} holds no addresses; run npm run router:plan:lut first.`);

  const fitsToday = plan.rows.filter((r) => r.fitsToday).length;
  const fitsWith = plan.rows.filter((r) => r.fitsWithTable).length;
  process.stdout.write(`Plan: ${addresses.length} addresses\n`);
  process.stdout.write(`  three-leg routes fitting today:      ${fitsToday}/${plan.rows.length}\n`);
  process.stdout.write(`  three-leg routes fitting with table: ${fitsWith}/${plan.rows.length}\n`);
  process.stdout.write(`  ${Math.ceil(addresses.length / ADDRESSES_PER_EXTEND)} extend transactions after creation\n\n`);

  if (!execute) {
    process.stdout.write("Planning only. Nothing was created.\n");
    process.stdout.write("To create it: HENAR_LUT_AUTHORIZED=1 npm run router:lut:setup -- --execute\n");
    return;
  }
  if (!authorized) {
    process.stdout.write("Refusing to execute: HENAR_LUT_AUTHORIZED=1 is not set.\n");
    process.stdout.write("This spends SOL and creates a permanent account; it needs an explicit decision.\n");
    process.exitCode = 1;
    return;
  }

  const keyPath = process.env.HENAR_LUT_KEYPAIR;
  if (!keyPath) throw new Error("HENAR_LUT_KEYPAIR must name the keypair file that pays for and owns the table.");
  const secret = JSON.parse(await readFile(keyPath, "utf8")) as number[];
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(rpc, "confirmed");

  const genesis = await connection.getGenesisHash();
  if (genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error(`refusing to run against a non-mainnet cluster (${genesis})`);

  const slot = await connection.getSlot("finalized");
  const [createIx, tableAddress] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  process.stdout.write(`Creating ${tableAddress.toBase58()} with ${payer.publicKey.toBase58()}…\n`);

  const sendTx = async (instructions: TransactionInstruction[]) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([payer]);
    const signature = await connection.sendTransaction(tx, { maxRetries: 3 });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  };

  process.stdout.write(`  created in ${await sendTx([createIx])}\n`);
  for (let i = 0; i < addresses.length; i += ADDRESSES_PER_EXTEND) {
    const chunk = addresses.slice(i, i + ADDRESSES_PER_EXTEND);
    const ix = AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: tableAddress, addresses: chunk });
    process.stdout.write(`  extended with ${chunk.length} (${i + chunk.length}/${addresses.length}) in ${await sendTx([ix])}\n`);
  }

  process.stdout.write(`\nHENAR_ROUTER_LOOKUP_TABLE=${tableAddress.toBase58()}\n`);
  process.stdout.write("Set that in the environment. The split cap opens a third leg only once it is set.\n");
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
