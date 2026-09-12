import { executePackSwap } from "./pack-swap";
import { protocolLookupTables } from "../../src/lib/protocol/lookup";
import {
  assertTransactionLimits,
  transactionLimits,
} from "../../src/lib/protocol/transaction-limits";
import { randomBytes } from "node:crypto";
import {
  PublicKey,
  TransactionMessage,
  ComputeBudgetProgram,
  type AddressLookupTableAccount,
  type TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getMint,
  getScaledUiAmountConfig,
  getTransferFeeConfig,
  calculateEpochFee,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import { Orao, randomnessAccountAddress } from "@orao-network/solana-vrf";
import { protocolContext } from "../../src/lib/protocol/context";
import {
  ata,
  common,
  integer,
  pda,
  USDC_KEY,
  type Accounts,
} from "../../src/lib/protocol/client";
import {
  vaultAccounts,
  conservativeShares,
} from "../../src/lib/protocol/kamino";
import { stockDelivery } from "../../src/lib/protocol/pricing";
import { fetchPrices, postPrices } from "./oracles";
import { stockSwap } from "./market";
import { Dispatcher } from "./transactions";
const big = (v: { toString: () => string }) => BigInt(v.toString());
const hex = (v: number[]) => Buffer.from(v).toString("hex");
const freshId = () => BigInt(`0x${randomBytes(8).toString("hex")}`);
export async function jobs() {
  const ctx = await protocolContext();
  const [packs, positions] = await Promise.all([
    ctx.client.account.pack.all(),
    ctx.client.account.position.all(),
  ]);
  return [
    ...packs
      .filter(
        (p) => "pending" in p.account.status || "selected" in p.account.status,
      )
      .map((p) => ({
        key: `pack:${p.publicKey}`,
        address: p.publicKey,
        kind: "pack" as const,
      })),
    ...positions
      .filter((p) => "active" in p.account.status)
      .map((p) => ({
        key: `position:${p.publicKey}`,
        address: p.publicKey,
        kind: "position" as const,
      })),
  ];
}
export async function executeJob(
  job: Awaited<ReturnType<typeof jobs>>[number],
  dispatch: Dispatcher,
  maxUSDC: bigint,
) {
  const ctx = await protocolContext();
  const { client, c, config, configKey, programId } = ctx,
    solver = dispatch.signer.publicKey;
  const now = Math.floor(Date.now() / 1000);
  let owner: PublicKey,
    manifestKey: PublicKey,
    index: number,
    slippage: number,
    budget: bigint,
    limit: bigint | undefined;
  let build: (
    delivered: bigint,
    stockPrice: PublicKey,
    usdcPrice: PublicKey,
    hooks: AccountMeta[],
  ) => Promise<TransactionInstruction>;
  const tables: AddressLookupTableAccount[] = await protocolLookupTables(c);
  let orderWithdrawals: AccountMeta[][] = [],
    orderWithdrawal: AccountMeta[] = [];
  let state: Accounts["position"] | null = null;
  if (job.kind === "pack") {
    let pack = await client.account.pack.fetch(job.address);
    if (
      Number(pack.expiresAt) <= now &&
      !(pack.lucky && "pending" in pack.status)
    )
      return;
    if ("pending" in pack.status) {
      const vrf = new Orao({ connection: c });
      const fulfilled = (
        await vrf.getRandomness(Buffer.from(pack.force))
      ).getFulfilledRandomness();
      if (!fulfilled) return;
      const randomness = randomnessAccountAddress(Buffer.from(pack.force));
      const pool = pda(programId, "lucky-pool");
      const resolution = pack.lucky
        ? client.methods.resolveLucky().accountsStrict({
            cash: {
              pack: job.address,
              pool,
              usdc: USDC_KEY,
              poolCash: ata(pool),
              packCash: ata(job.address),
              tokenProgram: common.tokenProgram,
            },
            manifest: pack.manifest,
            randomness,
          })
        : client.methods.resolvePack().accountsStrict({
            pack: job.address,
            manifest: pack.manifest,
            randomness,
          });
      await dispatch.instructions([await resolution.instruction()]);
      pack = await client.account.pack.fetch(job.address);
    }
    if (!("selected" in pack.status)) return;
    await executePackSwap(job.address, dispatch, maxUSDC);
    return;
  } else {
    state = await client.account.position.fetch(job.address);
    if (!("active" in state.status)) return;
    const base = {
      actor: solver,
      config: configKey,
      position: job.address,
      manifest: state.manifest,
      usdc: USDC_KEY,
      ownerCash: ata(state.owner),
      cash: ata(job.address),
      sharesMint: config.sharesMint,
      shares: ata(job.address, config.sharesMint),
      treasury: config.treasury,
      tokenProgram: common.tokenProgram,
    };
    const ownerAta = createAssociatedTokenAccountIdempotentInstruction(
      solver,
      ata(state.owner),
      state.owner,
      USDC_KEY,
    );
    if (
      "earn" in state.kind &&
      "packs" in state.destination &&
      state.autoPacks &&
      big(state.claimable) >= 10000000n
    ) {
      const id = freshId(),
        batch = pda(programId, "batch", solver, id);
      await dispatch.instructions([
        await client.methods
          .yieldBatch(integer(id))
          .accountsStrict({
            payer: solver,
            config: configKey,
            position: job.address,
            manifest: config.activeManifest,
            batch,
            positionCash: ata(job.address),
            batchCash: ata(batch),
            ...common,
          })
          .instruction(),
      ]);
      return;
    }
    const vault = await vaultAccounts(c, config.vault, job.address);
    orderWithdrawals = vault.withdrawGroups;
    orderWithdrawal = vault.withdraw;
    if (!vault.lookupTable.equals(PublicKey.default)) {
      const table = await c.getAddressLookupTable(vault.lookupTable);
      if (table.value) tables.push(table.value);
    }
    const issued = big(vault.state.sharesIssued),
      nav =
        issued === 0n
          ? 0n
          : (big(state.shares) * (big(vault.state.prevAumSf) >> 60n)) / issued;
    const basis = big(state.principalBasis) + big(state.investedFeeBasis),
      gross = nav > basis ? nav - basis : 0n;
    const fee =
      (gross * BigInt(state.yieldShareBps) + BigInt(state.feeCarry)) / 10000n;
    const minRedeemed = (nav * BigInt(10000 - config.maxSlippageBps)) / 10000n;
    if (
      "earn" in state.kind &&
      big(state.shares) > 0n &&
      now >= Number(state.updatedAt) + 3600 &&
      gross >= 100000n
    ) {
      const minShares = conservativeShares(
        vault.state,
        big(state.principalBasis),
        config.maxSlippageBps,
      );
      await dispatch.instructions(
        [
          ownerAta,
          await client.methods
            .harvest(
              vault.withdraw.length,
              integer(minRedeemed),
              integer(minShares),
            )
            .accountsStrict(base)
            .remainingAccounts([...vault.withdraw, ...vault.deposit])
            .instruction(),
        ],
        tables,
      );
      return;
    }
    owner = state.owner;
    manifestKey = state.manifest;
    index = state.stockIndex;
    slippage = state.slippageBps;
    if ("earn" in state.kind) {
      if (!("stocks" in state.destination) || big(state.claimable) < 1000000n)
        return;
      budget = big(state.claimable) > maxUSDC ? maxUSDC : big(state.claimable);
    } else {
      if (now < Number(state.nextFillAt) || now >= Number(state.expiresAt))
        return;
      const steps = BigInt(state.stepsRemaining);
      const principal =
        nav < big(state.principalBasis) ? nav : big(state.principalBasis);
      const raw =
        principal / steps + (big(state.claimable) + gross - fee) / steps;
      budget = raw - (raw * BigInt(state.tradeFeeBps)) / 10000n;
      if ("limit" in state.kind) limit = big(state.targetPrice);
    }
    // Oracle-gated position execution is separate from the oracle-free pack path.
    if (process.env.SOLVER_EXECUTE_POSITIONS !== "true") return;
    const current = state;
    build = async (delivered, stockPrice, usdcPrice, hooks) => {
      const manifest = await client.account.manifest.fetch(manifestKey),
        spec = manifest.stocks[index];
      const accounts = {
        base,
        stockMint: spec.mint,
        solverStock: ata(solver, spec.mint, spec.tokenProgram),
        ownerStock: ata(owner, spec.mint, spec.tokenProgram),
        stockProgram: spec.tokenProgram,
        stockPrice,
        usdcPrice,
        solverCash: ata(solver),
      };
      if ("earn" in current.kind)
        return client.methods
          .settleYield(integer(budget), integer(delivered))
          .accountsStrict(accounts)
          .remainingAccounts(hooks)
          .instruction();
      const remaining =
        big(current.principalBasis) -
        big(current.principalBasis) / BigInt(current.stepsRemaining);
      const minShares = remaining
        ? conservativeShares(vault.state, remaining, config.maxSlippageBps)
        : 0n;
      return client.methods
        .fillOrder(
          integer(delivered),
          orderWithdrawal.length,
          integer(minRedeemed),
          integer(minShares),
          hooks.length,
        )
        .accountsStrict(accounts)
        .remainingAccounts([...orderWithdrawal, ...vault.deposit, ...hooks])
        .instruction();
    };
  }
  if (budget <= 0n || budget > maxUSDC)
    throw new Error("Settlement exceeds configured solver budget.");
  const manifest = await client.account.manifest.fetch(manifestKey),
    spec = manifest.stocks[index];
  if (!spec) throw new Error("Manifest stock is unavailable.");
  const stockFeed = hex(spec.feed),
    usdcFeed = hex(config.usdcFeed);
  const prices = await fetchPrices([stockFeed, usdcFeed]);
  const mintInfo = await getMint(c, spec.mint, "confirmed", spec.tokenProgram);
  const scale = getScaledUiAmountConfig(mintInfo);
  const multiplier = scale
    ? BigInt(now) >= scale.newMultiplierEffectiveTimestamp
      ? scale.newMultiplier
      : scale.multiplier
    : 1;
  const { minimum } = stockDelivery(
    budget,
    prices.prices.get(stockFeed)!,
    prices.prices.get(usdcFeed)!,
    big(spec.ratioNumerator),
    big(spec.ratioDenominator),
    spec.decimals,
    slippage,
    now,
    config.oracleMaxAge,
    config.maxConfidenceBps,
    limit,
    multiplier,
  );
  const feeConfig = getTransferFeeConfig(mintInfo);
  let delivered = minimum;
  if (feeConfig) {
    const epoch = BigInt((await c.getEpochInfo()).epoch);
    const maximum =
      feeConfig.newerTransferFee.epoch <= epoch
        ? feeConfig.newerTransferFee.maximumFee
        : feeConfig.olderTransferFee.maximumFee;
    let low = minimum,
      high = minimum + maximum;
    const u64 = (1n << 64n) - 1n;
    if (high > u64) high = u64;
    while (low < high) {
      const mid = (low + high) / 2n;
      if (mid - calculateEpochFee(feeConfig, epoch, mid) >= minimum) high = mid;
      else low = mid + 1n;
    }
    if (low - calculateEpochFee(feeConfig, epoch, low) < minimum)
      throw new Error("Stock transfer fee exceeds settlement capacity.");
    delivered = low;
  }
  const inventory = await getAccount(
    c,
    ata(solver, spec.mint, spec.tokenProgram),
    "confirmed",
    spec.tokenProgram,
  ).catch(() => null);
  const setup = [
    createAssociatedTokenAccountIdempotentInstruction(
      solver,
      ata(owner),
      owner,
      USDC_KEY,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      solver,
      ata(owner, spec.mint, spec.tokenProgram),
      owner,
      spec.mint,
      spec.tokenProgram,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      solver,
      ata(solver),
      solver,
      USDC_KEY,
    ),
  ];
  let swap: Awaited<ReturnType<typeof stockSwap>> | null = null;
  if ((inventory?.amount ?? 0n) < delivered) {
    if (process.env.SOLVER_ROUTE_STOCKS !== "true")
      throw new Error("Solver inventory is insufficient; routing is disabled.");
    swap = await stockSwap(
      c,
      solver,
      spec.mint,
      budget,
      delivered,
      state && !("earn" in state.kind) ? 24 : 32,
    );
  }
  const transfer = await createTransferCheckedWithTransferHookInstruction(
    c,
    ata(solver, spec.mint, spec.tokenProgram),
    spec.mint,
    ata(owner, spec.mint, spec.tokenProgram),
    solver,
    delivered,
    spec.decimals,
    [],
    "confirmed",
    spec.tokenProgram,
  );
  let routeTables = [...tables, ...(swap?.tables ?? [])];
  // Validate composition before paying to post oracle accounts. These temporary keys
  // are used only for measuring a message; only real posted accounts reach submission.
  const shapeStock = new PublicKey(randomBytes(32)),
    shapeUsdc = new PublicKey(randomBytes(32));
  const latest = await c.getLatestBlockhash();
  const measure = async () =>
    new TransactionMessage({
      payerKey: solver,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ...setup,
        ...(swap?.instructions ?? []),
        await build(delivered, shapeStock, shapeUsdc, transfer.keys.slice(4)),
      ],
    }).compileToV0Message(routeTables);
  async function chooseReserveCoverage() {
    if (swap && state && !("earn" in state.kind)) {
      // A reduced reserve prefix must still redeem every share or the entire swap rolls back.
      for (let groups = orderWithdrawals.length; groups >= 1; groups--) {
        orderWithdrawal = orderWithdrawals.slice(0, groups).flat();
        if (transactionLimits(await measure()).fits) break;
      }
    }
  }
  await chooseReserveCoverage();
  if (swap) {
    for (const maxAccounts of [16, 12]) {
      if (transactionLimits(await measure()).fits) break;
      swap = await stockSwap(
        c,
        solver,
        spec.mint,
        budget,
        delivered,
        maxAccounts,
      );
      routeTables = [...tables, ...swap.tables];
      await chooseReserveCoverage();
    }
  }
  assertTransactionLimits(await measure());
  const posted = await postPrices(
    c,
    dispatch.signer,
    prices.binary,
    (tx, signers) => dispatch.signed(tx, signers),
  );
  {
    const stockPrice =
        posted.accounts[`0x${stockFeed}`] ?? posted.accounts[stockFeed],
      usdcPrice = posted.accounts[`0x${usdcFeed}`] ?? posted.accounts[usdcFeed];
    if (!stockPrice || !usdcPrice)
      throw new Error("Posted oracle accounts missing.");
    const settlement = await build(
      delivered,
      stockPrice,
      usdcPrice,
      transfer.keys.slice(4),
    );
    // Route and escrow settlement share one atomic transaction; no naked stock purchase can land.
    await dispatch.instructions(
      [...setup, ...(swap?.instructions ?? []), settlement],
      routeTables,
    );
  }
  // Only close updates after confirmed consumption. An uncertain submission must retain its accounts.
  await posted.cleanup();
}
