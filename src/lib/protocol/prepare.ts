import { assertTransactionLimits } from "./transaction-limits";
import { protocolLookupTables } from "./lookup";
import { createHash, randomBytes } from "node:crypto";
import {
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  Orao,
  PROGRAM_ID as ORAO,
  networkStateAccountAddress,
  randomnessAccountAddress,
} from "@orao-network/solana-vrf";
import { z } from "zod";
import { protocolContext } from "./context";
import { ata, common, integer, pda, USDC_KEY } from "./client";
import { conservativeShares, vaultAccounts } from "./kamino";
const u64 = z
  .string()
  .regex(/^\d{1,20}$/)
  .refine((v) => BigInt(v) <= 18446744073709551615n);
export const actionSchema = z.object({
  action: z.enum([
    "deposit",
    "withdraw",
    "cancel",
    "claim",
    "preferences",
    "buy",
    "gift",
    "refundBatch",
    "open",
    "refundPack",
    "yieldBatch",
    "openLucky",
    "bankLucky",
    "rollLucky",
    "refundLucky",
    "resolveLucky",
  ]),
  owner: z.string(),
  account: z.string().optional(),
  amount: u64.default("0"),
  count: u64.default("1"),
  kind: z.enum(["earn", "limit", "dca"]).default("earn"),
  destination: z.enum(["packs", "stocks"]).default("packs"),
  autoPacks: z.boolean().default(true),
  stockMint: z.string().optional(),
  stockIndex: z.number().int().min(0).max(63).default(0),
  targetPrice: u64.default("0"),
  steps: z.number().int().min(2).max(365).default(12),
  interval: z.number().int().min(3600).max(2678400).default(86400),
  expiresAt: u64.optional(),
  recipient: z.string().optional(),
  message: z.string().max(1024).default(""),
});
export type Action = z.infer<typeof actionSchema>;
export async function prepareAction(input: Action) {
  const { c, client, programId, configKey, config, manifest } =
    await protocolContext();
  const owner = new PublicKey(input.owner);
  if (!PublicKey.isOnCurve(owner.toBytes()))
    throw new Error("Use a Solana wallet.");
  const id = BigInt(`0x${randomBytes(8).toString("hex")}`),
    amount = integer(input.amount),
    count = integer(input.count);
  const review: Record<string, string | number | boolean> = {
    action: input.action,
    yieldShareBps: config.yieldShareBps,
    packFeeBps: config.packFeeBps,
    slippageBps: config.maxSlippageBps,
  };
  const targetIndex = (list: typeof manifest.stocks, fallback = 0) => {
    if (!input.stockMint) return fallback;
    const index = list.findIndex((s) => s.mint.toBase58() === input.stockMint);
    if (index < 0)
      throw new Error("This stock is not enabled in the position's manifest.");
    return index;
  };
  if (
    ((input.action === "deposit" &&
      (input.kind !== "earn" || input.destination === "stocks")) ||
      (input.action === "preferences" && input.destination === "stocks")) &&
    !input.stockMint
  )
    throw new Error("Select a verified stock mint.");
  const instructions: TransactionInstruction[] = [];
  const tables: AddressLookupTableAccount[] = await protocolLookupTables(c);
  if (["open", "openLucky", "bankLucky"].includes(input.action)) {
    const execution = await client.account.packExecution.fetchNullable(
      pda(programId, "pack-execution"),
    );
    if (input.action !== "bankLucky" && (!execution?.enabled || config.paused))
      throw new Error(
        "Pack delivery is currently unavailable. Your allocation stays in escrow.",
      );
    review.execution =
      "Jupiter swap, then delivery to your wallet, then reveal";
    review.quoteService =
      "Kani chooses the market quote; no independent price oracle";
    review.protection =
      "Exact allocation, selected stock, minimum received and 30-second quote expiry";
  }
  if (input.action === "deposit" || input.action === "preferences") {
    review.yieldDestination = input.destination;
    review.autoPacks = input.autoPacks;
    if (input.stockMint) review.stockMint = input.stockMint;
    if (input.kind !== "earn") {
      review.orderType = input.kind;
      review.tradeFeeBps = config.tradeFeeBps;
      review.targetPriceUSDC = input.targetPrice;
    }
  }
  if (input.action === "gift") {
    review.recipient = input.recipient ?? "";
    review.message = input.message;
    review.quantity = input.count;
  }
  if (input.action === "buy" || input.action === "refundBatch")
    review.quantity = input.count;
  const ownerCash = ata(owner);
  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      ownerCash,
      owner,
      USDC_KEY,
    ),
  );
  let resource: PublicKey;
  if (input.action === "deposit" && !input.account) {
    if (amount.isZero()) throw new Error("Enter a deposit amount.");
    resource = pda(programId, "position", owner, id);
    const vault = await vaultAccounts(c, config.vault, resource);
    const minShares = conservativeShares(
      vault.state,
      BigInt(input.amount),
      config.maxSlippageBps,
    );
    instructions.push(
      await client.methods
        .createPosition(integer(id), amount, integer(minShares), {
          kind: { [input.kind]: {} },
          destination: { [input.destination]: {} },
          autoPacks: input.autoPacks,
          stockIndex: targetIndex(manifest.stocks),
          targetPrice: integer(input.targetPrice),
          steps: input.steps,
          intervalSeconds: input.interval,
          expiresAt: integer(
            input.expiresAt ?? Math.floor(Date.now() / 1000 + 30 * 86400),
          ),
          slippageBps: config.maxSlippageBps,
        })
        .accountsStrict({
          owner,
          config: configKey,
          manifest: config.activeManifest,
          position: resource,
          ownerCash,
          cash: ata(resource),
          sharesMint: config.sharesMint,
          shares: ata(resource, config.sharesMint),
          ...common,
        })
        .remainingAccounts(vault.deposit)
        .instruction(),
    );
    review.depositUSDC = input.amount;
    review.minimumShares = minShares.toString();
    review.vaultDepositFeeUSDC = (
      BigInt(vault.state.crankFundFeePerReserve.toString()) *
      BigInt(
        vault.state.vaultAllocationStrategy.filter(
          (a) => a.reserve !== PublicKey.default.toBase58(),
        ).length,
      )
    ).toString();
    if (!vault.lookupTable.equals(PublicKey.default)) {
      const table = await c.getAddressLookupTable(vault.lookupTable);
      if (table.value) tables.push(table.value);
    }
  } else if (
    [
      "deposit",
      "withdraw",
      "cancel",
      "claim",
      "preferences",
      "yieldBatch",
    ].includes(input.action)
  ) {
    if (!input.account) throw new Error("Choose an earning position.");
    resource = new PublicKey(input.account);
    const position = await client.account.position.fetch(resource);
    if (!position.owner.equals(owner) || !position.config.equals(configKey))
      throw new Error("Position owner mismatch.");
    const positionManifest = await client.account.manifest.fetch(
      position.manifest,
    );
    const stockIndex = targetIndex(
      positionManifest.stocks,
      position.stockIndex,
    );
    const base = {
      actor: owner,
      config: configKey,
      position: resource,
      manifest: position.manifest,
      usdc: USDC_KEY,
      ownerCash,
      cash: ata(resource),
      sharesMint: config.sharesMint,
      shares: ata(resource, config.sharesMint),
      treasury: config.treasury,
      tokenProgram: common.tokenProgram,
    };
    if (input.action === "preferences")
      instructions.push(
        await client.methods
          .setPreferences(
            { [input.destination]: {} },
            input.autoPacks,
            stockIndex,
          )
          .accountsStrict({
            owner,
            position: resource,
            manifest: position.manifest,
          })
          .instruction(),
      );
    else if (input.action === "claim")
      instructions.push(
        await client.methods
          .claimYield(amount)
          .accountsStrict(base)
          .instruction(),
      );
    else if (input.action === "yieldBatch") {
      const batch = pda(programId, "batch", owner, id);
      instructions.push(
        await client.methods
          .yieldBatch(integer(id))
          .accountsStrict({
            payer: owner,
            config: configKey,
            position: resource,
            manifest: config.activeManifest,
            batch,
            positionCash: ata(resource),
            batchCash: ata(batch),
            ...common,
          })
          .instruction(),
      );
      resource = batch;
    } else {
      const vault = await vaultAccounts(c, config.vault, resource);
      if (!vault.lookupTable.equals(PublicKey.default)) {
        const table = await c.getAddressLookupTable(vault.lookupTable);
        if (table.value) tables.push(table.value);
      }
      if (input.action === "deposit") {
        const minShares = conservativeShares(
          vault.state,
          BigInt(input.amount),
          config.maxSlippageBps,
        );
        instructions.push(
          await client.methods
            .depositMore(amount, integer(minShares))
            .accountsStrict(base)
            .remainingAccounts(vault.deposit)
            .instruction(),
        );
        review.depositUSDC = input.amount;
        instructions.push(
          await client.methods
            .setPreferences(
              { [input.destination]: {} },
              input.autoPacks,
              stockIndex,
            )
            .accountsStrict({
              owner,
              position: resource,
              manifest: position.manifest,
            })
            .instruction(),
        );
      } else {
        const shares = BigInt(position.shares.toString()),
          issued = BigInt(vault.state.sharesIssued.toString());
        const nav =
          issued === 0n
            ? 0n
            : (shares * (BigInt(vault.state.prevAumSf.toString()) >> 60n)) /
              issued;
        const minRedeemed =
          (nav * BigInt(10000 - config.maxSlippageBps)) / 10000n;
        const remaining =
          BigInt(position.principalBasis.toString()) > BigInt(input.amount)
            ? BigInt(position.principalBasis.toString()) - BigInt(input.amount)
            : 0n;
        const minShares =
          remaining > 0n
            ? conservativeShares(vault.state, remaining, config.maxSlippageBps)
            : 0n;
        const method =
          input.action === "cancel"
            ? client.methods.cancelOrder(
                vault.withdraw.length,
                integer(minRedeemed),
              )
            : client.methods.withdrawPrincipal(
                amount,
                vault.withdraw.length,
                integer(minRedeemed),
                integer(minShares),
              );
        instructions.push(
          await method
            .accountsStrict(base)
            .remainingAccounts([
              ...vault.withdraw,
              ...(input.action === "cancel" ? [] : vault.deposit),
            ])
            .instruction(),
        );
        review.minimumRedeemedUSDC = minRedeemed.toString();
        review.withdrawalPenaltyBps =
          vault.state.withdrawalPenaltyBps.toString();
        review.withdrawalPenaltyUSDC =
          vault.state.withdrawalPenaltyLamports.toString();
      }
    }
  } else if (input.action === "buy") {
    resource = pda(programId, "batch", owner, id);
    instructions.push(
      await client.methods
        .buyBatch(integer(id), count, config.maxSlippageBps)
        .accountsStrict({
          owner,
          config: configKey,
          manifest: config.activeManifest,
          batch: resource,
          ownerCash,
          batchCash: ata(resource),
          ...common,
        })
        .instruction(),
    );
    review.totalUSDC = (BigInt(input.count) * 10000000n).toString();
    review.protocolFeeUSDC = (
      (BigInt(input.count) * 10000000n * BigInt(config.packFeeBps)) /
      10000n
    ).toString();
  } else if (
    ["bankLucky", "rollLucky", "refundLucky", "resolveLucky"].includes(
      input.action,
    )
  ) {
    if (!input.account) throw new Error("Choose a Lucky pack.");
    resource = new PublicKey(input.account);
    const pack = await client.account.pack.fetch(resource);
    if (
      !pack.owner.equals(owner) ||
      !pack.config.equals(configKey) ||
      !pack.lucky
    )
      throw new Error("Lucky pack owner or configuration mismatch.");
    const pool = pda(programId, "lucky-pool");
    const cash = {
      pack: resource,
      pool,
      usdc: USDC_KEY,
      poolCash: ata(pool),
      packCash: ata(resource),
      tokenProgram: common.tokenProgram,
    };
    const base = {
      cash,
      owner,
      config: configKey,
      ownerCash,
      randomness: randomnessAccountAddress(Buffer.from(pack.force)),
    };
    review.stockBudgetUSDC = pack.budget.toString();
    review.round = pack.round;
    review.additionalProtocolFeeUSDC = "0";
    if (input.action === "resolveLucky") {
      instructions.push(
        await client.methods
          .resolveLucky()
          .accountsStrict({
            cash,
            manifest: pack.manifest,
            randomness: base.randomness,
          })
          .instruction(),
      );
    } else if (input.action === "rollLucky") {
      const poolState = await client.account.luckyPool.fetch(pool);
      if (
        !poolState.enabled ||
        config.paused ||
        pack.round !== 1 ||
        !("luckyReady" in pack.status)
      )
        throw new Error(
          "Rollover is unavailable. You can still bank your resolved allocation.",
        );
      const nonce = randomBytes(32);
      const force = createHash("sha256")
        .update(
          Buffer.concat([
            Buffer.from("kani-lucky-roll-v1"),
            programId.toBuffer(),
            resource.toBuffer(),
            Buffer.from([2]),
            nonce,
          ]),
        )
        .digest();
      const network = await new Orao({ connection: c }).getNetworkState();
      instructions.push(
        await client.methods
          .rollLucky([...nonce])
          .accountsStrict({
            base: { ...base, randomness: randomnessAccountAddress(force) },
            network: networkStateAccountAddress(),
            oraoTreasury: network.config.treasury,
            oraoProgram: ORAO,
            systemProgram: common.systemProgram,
          })
          .instruction(),
      );
      review.amountAtRiskUSDC = pack.budget.toString();
      review.minimumAllocationUSDC = (
        BigInt(pack.budget.toString()) / 4n
      ).toString();
      review.maximumAllocationUSDC = (
        BigInt(pack.budget.toString()) * 2n
      ).toString();
      review.theoreticalReturnBps = 9500;
      review.odds = "0.25×: 10% · 0.5×: 45% · 1×: 15% · 1.5×: 10% · 2×: 20%";
      review.randomnessFeeLamports = network.config.requestFee.toString();
      review.remainingRollovers = 0;
    } else {
      instructions.push(
        await (
          input.action === "bankLucky"
            ? client.methods.bankLucky()
            : client.methods.refundLucky()
        )
          .accountsStrict(base)
          .instruction(),
      );
    }
  } else {
    if (!input.account) throw new Error("Choose a pack.");
    resource = new PublicKey(input.account);
    if (input.action === "refundPack") {
      const pack = await client.account.pack.fetch(resource);
      if (!pack.owner.equals(owner)) throw new Error("Pack owner mismatch.");
      instructions.push(
        await client.methods
          .refundPack()
          .accountsStrict({
            owner,
            pack: resource,
            usdc: USDC_KEY,
            ownerCash,
            packCash: ata(resource),
            tokenProgram: common.tokenProgram,
          })
          .instruction(),
      );
    } else {
      const batch = await client.account.packBatch.fetch(resource);
      if (!batch.owner.equals(owner)) throw new Error("Pack owner mismatch.");
      if (input.action === "refundBatch")
        instructions.push(
          await client.methods
            .refundBatch(count)
            .accountsStrict({
              owner,
              batch: resource,
              usdc: USDC_KEY,
              ownerCash,
              batchCash: ata(resource),
              tokenProgram: common.tokenProgram,
            })
            .instruction(),
        );
      else if (input.action === "gift") {
        if (!input.recipient) throw new Error("Choose a recipient.");
        const gift = pda(programId, "batch", owner, id);
        instructions.push(
          await client.methods
            .giftBatch(
              integer(id),
              count,
              new PublicKey(input.recipient),
              input.message,
            )
            .accountsStrict({
              owner,
              batch: resource,
              gift,
              batchCash: ata(resource),
              giftCash: ata(gift),
              ...common,
            })
            .instruction(),
        );
        resource = gift;
      } else {
        const pack = pda(
          programId,
          "pack",
          resource,
          BigInt(batch.nextOpen.toString()),
        );
        const nonce = randomBytes(32),
          force = createHash("sha256")
            .update(
              Buffer.concat([
                Buffer.from("stockroom-v1-vrf"),
                programId.toBuffer(),
                pack.toBuffer(),
                nonce,
              ]),
            )
            .digest();
        const network = await new Orao({ connection: c }).getNetworkState();
        const base = {
          owner,
          config: configKey,
          batch: resource,
          pack,
          batchCash: ata(resource),
          packCash: ata(pack),
          network: networkStateAccountAddress(),
          oraoTreasury: network.config.treasury,
          randomness: randomnessAccountAddress(force),
          oraoProgram: ORAO,
          ...common,
        };
        if (input.action === "openLucky") {
          if (!("purchased" in batch.source))
            throw new Error("Earned packs open in Random mode.");
          const pool = pda(programId, "lucky-pool");
          const state = await client.account.luckyPool.fetchNullable(pool);
          if (!state?.enabled)
            throw new Error(
              "Lucky opening is not enabled. Random opening remains available.",
            );
          instructions.push(
            await client.methods
              .openLucky(batch.nextOpen, [...nonce])
              .accountsStrict({
                base,
                pool,
                poolCash: ata(pool),
                treasury: config.treasury,
              })
              .instruction(),
          );
          const stake = 10000000n - BigInt(batch.unitFee.toString());
          review.mode = "Lucky · fixed V1 odds";
          review.amountAtRiskUSDC = stake.toString();
          review.minimumAllocationUSDC = (stake / 4n).toString();
          review.maximumAllocationUSDC = (stake * 2n).toString();
          review.theoreticalReturnBps = 9500;
          review.odds =
            "0.25×: 10% · 0.5×: 45% · 1×: 15% · 1.5×: 10% · 2×: 20%";
          review.feeTiming =
            "Charged once on opening; non-refundable after opening";
          review.rollover =
            "One optional rollover, subject to available reserve";
        } else {
          instructions.push(
            await client.methods
              .openPack(batch.nextOpen, [...nonce])
              .accountsStrict(base)
              .instruction(),
          );
        }
        review.randomnessFeeLamports = network.config.requestFee.toString();
        review.protocolFeeUSDC = batch.unitFee.toString();
        resource = pack;
      }
    }
  }
  const latest = await c.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ...instructions,
      ],
    }).compileToV0Message(tables),
  );
  assertTransactionLimits(tx.message);
  const bytes = tx.serialize();
  const ownerBefore = await c.getBalance(owner, "confirmed");
  const simulation = await c.simulateTransaction(tx, {
    sigVerify: false,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [owner.toBase58()] },
  });
  if (simulation.value.err)
    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  const networkFee = await c.getFeeForMessage(tx.message);
  const ownerAfter = simulation.value.accounts?.[0]?.lamports;
  if (
    ownerAfter !== undefined &&
    Number.isSafeInteger(ownerBefore) &&
    Number.isSafeInteger(ownerAfter)
  )
    review.totalSOLDebitLamports = Math.max(0, ownerBefore - ownerAfter);
  const computeUnits = simulation.value.unitsConsumed;
  return {
    transaction: Buffer.from(bytes).toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    resource: resource.toBase58(),
    review: {
      ...review,
      networkFeeLamports: networkFee.value ?? "unavailable",
      computeUnits: computeUnits ?? 0,
    },
    manifestStocks: manifest.stocks.length,
  };
}
