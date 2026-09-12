import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { networkStateAccountAddress, randomnessAccountAddress, PROGRAM_ID as ORAO } from "@orao-network/solana-vrf";
import { program, pda, ata, common, USDC_KEY, integer } from "../src/lib/protocol/client";
import { assertTransactionLimits } from "../src/lib/protocol/transaction-limits";
test("Lucky opening, rollover, banking and recovery fit real uncompressed transaction envelopes",async()=>{
  const id=Keypair.generate().publicKey,owner=Keypair.generate().publicKey;
  const client=program(new Connection("http://localhost:8899"),id);
  const config=pda(id,"config"),pool=pda(id,"lucky-pool"),batch=pda(id,"batch",owner,1n),pack=pda(id,"pack",batch,0n),manifest=pda(id,"manifest",1n);
  const nonce=Buffer.alloc(32,17),randomness=randomnessAccountAddress(nonce),network=networkStateAccountAddress(),oraoTreasury=Keypair.generate().publicKey,treasury=ata(Keypair.generate().publicKey);
  const base={owner,config,batch,pack,batchCash:ata(batch),packCash:ata(pack),network,oraoTreasury,randomness,oraoProgram:ORAO,...common};
  const cash={pack,pool,usdc:USDC_KEY,poolCash:ata(pool),packCash:ata(pack),tokenProgram:common.tokenProgram};
  const ownerBase={cash,owner,config,ownerCash:ata(owner),randomness};
  const instructions=await Promise.all([
    client.methods.openLucky(integer(0),[...nonce]).accountsStrict({base,pool,poolCash:ata(pool),treasury}).instruction(),
    client.methods.rollLucky([...nonce]).accountsStrict({base:ownerBase,network,oraoTreasury,oraoProgram:ORAO,systemProgram:common.systemProgram}).instruction(),
    client.methods.bankLucky().accountsStrict(ownerBase).instruction(),
    client.methods.refundLucky().accountsStrict(ownerBase).instruction(),
    client.methods.resolveLucky().accountsStrict({cash,manifest,randomness}).instruction(),
  ]);
  for(const ix of instructions) {
    const message=new TransactionMessage({payerKey:owner,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000}),createAssociatedTokenAccountIdempotentInstruction(owner,ata(owner),owner,USDC_KEY),ix]}).compileToV0Message();
    assertTransactionLimits(message);
    assert.ok(new VersionedTransaction(message).serialize().length<=1232);
  }
});
