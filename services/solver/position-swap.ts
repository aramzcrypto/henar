import {
  PublicKey,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getMint,
  getScaledUiAmountConfig,
} from "@solana/spl-token";
import Decimal from "decimal.js";
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
  conservativeShares,
  vaultAccounts,
} from "../../src/lib/protocol/kamino";
import { protocolLookupTables } from "../../src/lib/protocol/lookup";
import { transactionLimits } from "../../src/lib/protocol/transaction-limits";
import { fetchPackRoute, JUPITER_ROUTER } from "./pack-swap";
import type { Dispatcher } from "./transactions";
const big = (v: { toString(): string }) => BigInt(v.toString());
/** Estimate only; the program redeems actual shares and enforces the final budget. */
export function installmentBudget(
  state: Pick<
    Accounts["position"],
    | "principalBasis"
    | "investedFeeBasis"
    | "claimable"
    | "feeCarry"
    | "yieldShareBps"
    | "tradeFeeBps"
    | "stepsRemaining"
  >,
  nav: bigint,
) {
  const principal =
    nav < big(state.principalBasis) ? nav : big(state.principalBasis);
  const basis = big(state.principalBasis) + big(state.investedFeeBasis);
  const gross = nav > basis ? nav - basis : 0n;
  const fee =
    (gross * BigInt(state.yieldShareBps) + BigInt(state.feeCarry)) / 10000n;
  const steps = BigInt(state.stepsRemaining);
  if (steps <= 0n) return { budget: 0n, remaining: 0n, fee: 0n };
  const raw = principal / steps + (big(state.claimable) + gross - fee) / steps;
  const tradeFee = (raw * BigInt(state.tradeFeeBps)) / 10000n;
  return {
    budget: raw - tradeFee,
    remaining: principal - principal / steps,
    fee: tradeFee,
  };
}
export async function executePositionSwap(
  address: PublicKey,
  dispatch: Dispatcher,
  maxUSDC: bigint,
) {
  const { client, c, config, configKey, programId } = await protocolContext();
  const state = await client.account.position.fetch(address);
  if (!("active" in state.status)) return;
  const earn = "earn" in state.kind;
  const now = Math.floor(Date.now() / 1000);
  if (
    earn
      ? !("stocks" in state.destination) || big(state.claimable) < 1000000n
      : now < Number(state.nextFillAt) ||
        now >= Number(state.expiresAt) ||
        state.stepsRemaining === 0
  )
    return;
  const execution = pda(programId, "pack-execution");
  const policy = await client.account.packExecution.fetch(execution);
  if (
    config.paused ||
    !policy.enabled ||
    !policy.authority.equals(dispatch.signer.publicKey)
  )
    throw new Error("Position execution is not enabled for this worker.");
  const vault = earn ? null : await vaultAccounts(c, config.vault, address);
  const nav =
    vault && big(vault.state.sharesIssued) > 0n
      ? (big(state.shares) * (big(vault.state.prevAumSf) >> 60n)) /
        big(vault.state.sharesIssued)
      : 0n;
  const installment = installmentBudget(state, nav);
  const cap = maxUSDC < big(policy.maxBudget) ? maxUSDC : big(policy.maxBudget);
  const available = earn
    ? big(state.claimable) < cap
      ? big(state.claimable)
      : cap
    : installment.budget;
  if (available <= 0n || available > cap)
    throw new Error("Position installment exceeds the execution budget.");
  // Leave a small quoted-input margin for vault rounding; the contract refunds
  // the exact remainder and rejects input outside the user's slippage band.
  const input = earn
    ? available
    : (available * BigInt(10000 - Math.min(20, state.slippageBps))) / 10000n;
  if (input === 0n) return;
  const manifest = await client.account.manifest.fetch(state.manifest),
    spec = manifest.stocks[state.stockIndex];
  if (!spec) throw new Error("Position stock is unavailable.");
  const payer = dispatch.signer.publicKey,
    destination = ata(state.owner, spec.mint, spec.tokenProgram);
  const tables = await protocolLookupTables(c);
  if (vault && !vault.lookupTable.equals(PublicKey.default)) {
    const table = await c.getAddressLookupTable(vault.lookupTable);
    if (table.value) tables.push(table.value);
  }
  const setup = [
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata(state.owner),
      state.owner,
      USDC_KEY,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      destination,
      state.owner,
      spec.mint,
      spec.tokenProgram,
    ),
  ];
  const minShares =
    vault && installment.remaining > 0n
      ? conservativeShares(
          vault.state,
          installment.remaining,
          config.maxSlippageBps,
        )
      : 0n;
  const deposit = minShares > 0n ? vault!.deposit : [];
  const base = {
    actor: payer,
    config: configKey,
    position: address,
    manifest: state.manifest,
    usdc: USDC_KEY,
    ownerCash: ata(state.owner),
    cash: ata(address),
    sharesMint: config.sharesMint,
    shares: ata(address, config.sharesMint),
    treasury: config.treasury,
    tokenProgram: common.tokenProgram,
  };
  for (const maxAccounts of [24, 16, 12]) {
    const route = await fetchPackRoute(
      c,
      address,
      state.owner,
      payer,
      spec.mint,
      destination,
      input,
      state.slippageBps,
      maxAccounts,
    );
    if ("limit" in state.kind) {
      const info = await getMint(c, spec.mint, "confirmed", spec.tokenProgram),
        scaled = getScaledUiAmountConfig(info);
      const multiplier = scaled
        ? BigInt(now) >= scaled.newMultiplierEffectiveTimestamp
          ? scaled.newMultiplier
          : scaled.multiplier
        : 1;
      const maximumValue = new Decimal(route.minimum.toString())
        .mul(multiplier)
        .mul(state.targetPrice.toString())
        .div(new Decimal(10).pow(spec.decimals));
      if (maximumValue.lt((input + installment.fee).toString())) return;
    }
    const latest = await c.getLatestBlockhash();
    for (
      let groups = vault?.withdrawGroups.length ?? 0;
      groups >= (earn ? 0 : 1);
      groups--
    ) {
      const withdraw = vault?.withdrawGroups.slice(0, groups).flat() ?? [];
      const ix = await client.methods
        .swapPosition(
          {
            input: integer(input),
            quotedOutput: integer(route.output),
            minimumOutput: integer(route.minimum),
            quotedAt: integer(BigInt(route.quotedAt)),
            withdrawAccounts: withdraw.length,
            depositAccounts: deposit.length,
            minimumRedeemed: integer(
              (nav * BigInt(10000 - config.maxSlippageBps)) / 10000n,
            ),
            minimumShares: integer(minShares),
          },
          route.route,
        )
        .accountsStrict({
          base,
          execution,
          stockMint: spec.mint,
          ownerStock: destination,
          stockProgram: spec.tokenProgram,
          jupiter: JUPITER_ROUTER,
        })
        .remainingAccounts([...withdraw, ...deposit, ...route.keys])
        .instruction();
      const instructions = [...setup, ...route.setup, ix],
        lookup = [...tables, ...route.tables];
      const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
          ...instructions,
        ],
      }).compileToV0Message(lookup);
      if (!transactionLimits(message).fits) continue;
      if (Date.now() / 1000 - route.quotedAt > 25)
        throw new Error("Position quote expired; retry with a fresh quote.");
      await dispatch.instructions(instructions, lookup);
      return;
    }
  }
  throw new Error("Position route does not fit; escrow remains untouched.");
}
