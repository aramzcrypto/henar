import { executePackSwap } from "./pack-swap";
import { executePositionSwap } from "./position-swap";
import { protocolLookupTables } from "../../src/lib/protocol/lookup";
import { randomBytes } from "node:crypto";
import { PublicKey, type AddressLookupTableAccount } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Orao, randomnessAccountAddress } from "@orao-network/solana-vrf";
import { protocolContext } from "../../src/lib/protocol/context";
import {
  ata,
  common,
  integer,
  pda,
  USDC_KEY,
} from "../../src/lib/protocol/client";
import {
  vaultAccounts,
  conservativeShares,
} from "../../src/lib/protocol/kamino";
import { Dispatcher } from "./transactions";
const big = (v: { toString: () => string }) => BigInt(v.toString());
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
      .filter(
        (p) =>
          "active" in p.account.status &&
          (big(p.account.shares) > 0n || big(p.account.claimable) > 0n),
      )
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
  const tables: AddressLookupTableAccount[] = await protocolLookupTables(c);
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
    const state = await client.account.position.fetch(job.address);
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
    await executePositionSwap(job.address, dispatch, maxUSDC);
  }
}
