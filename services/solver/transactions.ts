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
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: this.signer.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
          ...instructions,
        ],
      }).compileToV0Message(tables),
    );
    assertTransactionLimits(tx.message);
    await this.signed(tx);
  }
}
