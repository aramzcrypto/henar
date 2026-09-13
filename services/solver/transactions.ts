import { assertTransactionLimits } from "../../src/lib/protocol/transaction-limits";
import { awaitConfirmation } from "../../src/lib/protocol/confirmation";
import { utils } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  type Signer,
  type TransactionInstruction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
export class Dispatcher {
  constructor(
    readonly connection: Connection,
    readonly signer: Keypair,
    readonly record: (signature: string, blockhash: string) => Promise<void>,
  ) {}
  async signed(tx: VersionedTransaction, extra: Signer[] = []) {
    assertTransactionLimits(tx.message);
    tx.sign([this.signer, ...extra]);
    const simulation = await this.connection.simulateTransaction(tx, {
      sigVerify: true,
      commitment: "confirmed",
    });
    if (simulation.value.err)
      throw new Error(
        `Simulation rejected: ${JSON.stringify(simulation.value.err)}`,
      );
    const signature = utils.bytes.bs58.encode(tx.signatures[0]);
    await this.record(signature, tx.message.recentBlockhash);
    await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    // Never send a replacement transaction after an uncertain result in this job. Reconcile signature first.
    await awaitConfirmation(this.connection, signature);
  }
  async instructions(
    instructions: TransactionInstruction[],
    tables: AddressLookupTableAccount[] = [],
  ) {
    const latest = await this.connection.getLatestBlockhash();
    const build = (units: number) =>
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: this.signer.publicKey,
          recentBlockhash: latest.blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
            ...instructions,
          ],
        }).compileToV0Message(tables),
      );
    const probe = build(1_400_000);
    assertTransactionLimits(probe.message);
    const simulated = await this.connection.simulateTransaction(probe, {
      sigVerify: false,
      commitment: "confirmed",
    });
    if (simulated.value.err)
      throw new Error(
        `Simulation rejected: ${JSON.stringify(simulated.value.err)}`,
      );
    const used = simulated.value.unitsConsumed;
    if (
      used === undefined ||
      !Number.isSafeInteger(used) ||
      used < 0 ||
      used > 1_400_000
    )
      throw new Error("Compute estimate unavailable; no transaction sent.");
    // Reserve measured compute plus headroom instead of needlessly reserving
    // the block maximum for small transfers and account setup.
    const tx = build(
      Math.min(1_400_000, Math.max(10000, Math.ceil(used * 1.2) + 10000)),
    );
    assertTransactionLimits(tx.message);
    await this.signed(tx);
  }
}
