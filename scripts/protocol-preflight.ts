import { protocolLookupTables } from "../src/lib/protocol/lookup";
import { safeError } from "../src/lib/protocol/errors";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getMint,
  getExtensionTypes,
  ExtensionType,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { protocolContext } from "../src/lib/protocol/context";
import { vaultState, KVAULT, KLEND } from "../src/lib/protocol/kamino";
import { JUPITER_ROUTER } from "../services/solver/pack-swap";
import { pda, USDC_KEY } from "../src/lib/protocol/client";
import { PROGRAM_ID as ORAO } from "@orao-network/solana-vrf";
async function main() {
  const report: { check: string; status: string; detail?: string }[] = [];
  for (const name of [
    "SOLANA_RPC_URL",
    "STOCKROOM_PROGRAM_ID",
    "JUPITER_API_KEY",
    "STOCKROOM_LOOKUP_TABLE",
  ]) {
    report.push({
      check: name,
      status: process.env[name] ? "configured" : "missing",
    });
  }
  try {
    const elf = await readFile("target/deploy/stockroom.so");
    report.push({
      check: "local-program",
      status: "built",
      detail: createHash("sha256").update(elf).digest("hex"),
    });
  } catch {
    report.push({ check: "local-program", status: "missing" });
  }
  if (!process.env.SOLANA_RPC_URL || !process.env.STOCKROOM_PROGRAM_ID) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const { c, config, manifest, programId, client } =
    await protocolContext().catch((error) => {
      console.log(JSON.stringify(report, null, 2));
      throw error;
    });
  for (const key of [programId, KVAULT, KLEND, ORAO, JUPITER_ROUTER]) {
    const info = await c.getAccountInfo(key);
    if (!info?.executable)
      throw new Error(`Required program unavailable: ${key}`);
  }
  const lookupTables = await protocolLookupTables(c);
  report.push({
    check: "protocol-lookup-table",
    status: lookupTables.length ? "available" : "missing",
  });
  const deployed = await c.getAccountInfo(programId);
  if (!deployed || deployed.data.readUInt32LE(0) !== 2)
    throw new Error("Expected upgradeable deployment.");
  const programData = await c.getAccountInfo(
    new PublicKey(deployed.data.subarray(4, 36)),
  );
  const local = await readFile("target/deploy/stockroom.so");
  if (
    !programData ||
    !programData.data.subarray(45, 45 + local.length).equals(local) ||
    programData.data.subarray(45 + local.length).some((byte) => byte !== 0)
  )
    throw new Error(
      "Deployed executable does not match the local checked build.",
    );
  report.push({ check: "deployed-binary", status: "matches-local-build" });
  const execution = await client.account.packExecution.fetchNullable(
    pda(programId, "pack-execution"),
  );
  report.push({
    check: "pack-execution",
    status: execution?.enabled ? "enabled" : "missing",
    detail: execution
      ? `Quote authority ${execution.authority}; max budget ${execution.maxBudget} base units; no independent price oracle`
      : "Configure the pack quote authority",
  });
  report.push({
    check: "position-execution",
    status: execution?.enabled ? "configured" : "missing",
    detail:
      "Direct Jupiter escrow execution; limit price and net delivery enforced onchain. No Pyth requirement.",
  });
  const treasury = await getAccount(c, config.treasury);
  if (!treasury.mint.equals(USDC_KEY))
    throw new Error("Treasury must hold canonical USDC.");
  const vault = await vaultState(c, config.vault);
  if (vault.sharesMint !== config.sharesMint.toBase58())
    throw new Error("Vault share mint mismatch.");
  if (
    !vault.withdrawalPenaltyBps.isZero() ||
    !vault.withdrawalPenaltyLamports.isZero()
  )
    throw new Error(
      "Permissionless harvest requires a vault without withdrawal penalties.",
    );
  if (!manifest.sealed) throw new Error("Active manifest is not sealed.");
  const allowed = new Set([
    ExtensionType.TransferFeeConfig,
    ExtensionType.MetadataPointer,
    ExtensionType.TokenMetadata,
    ExtensionType.PermanentDelegate,
    ExtensionType.DefaultAccountState,
    ExtensionType.PausableConfig,
    ExtensionType.ConfidentialTransferMint,
    ExtensionType.TransferHook,
    ExtensionType.ScaledUiAmountConfig,
  ]);
  for (const stock of manifest.stocks) {
    const mint = await getMint(c, stock.mint, "confirmed", stock.tokenProgram);
    if (mint.decimals !== stock.decimals)
      throw new Error(`Mint decimals changed: ${stock.mint}`);
    if (
      !stock.tokenProgram.equals(TOKEN_PROGRAM_ID) &&
      getExtensionTypes(mint.tlvData).some((e) => !allowed.has(e))
    )
      throw new Error(`Unsupported token extension: ${stock.mint}`);
  }
  report.push(
    {
      check: "mainnet-programs-and-config",
      status: "verified",
      detail: programId.toBase58(),
    },
    { check: "program-pause", status: config.paused ? "paused" : "unpaused" },
    {
      check: "admission-policy",
      status: config.enabledProducts ? "configured" : "products-disabled",
      detail: `mask ${config.enabledProducts}; pilot ${config.pilotOwner}; admitted ${config.admittedUsdc}/${config.admissionLimit} USDC base units`,
    },
    {
      check: "fees",
      status: "read-from-chain",
      detail: `yield ${config.yieldShareBps} bps; packs ${config.packFeeBps} bps; orders ${config.tradeFeeBps} bps`,
    },
    {
      check: "funded-mainnet-smoke",
      status: "requires-confirmed-transaction-evidence",
    },
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.some((item) => item.status === "missing")) process.exitCode = 1;
}
main().catch((error) => {
  console.error(safeError(error, "Preflight failed"));
  process.exitCode = 1;
});
