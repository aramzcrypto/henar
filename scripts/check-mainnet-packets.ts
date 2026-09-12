import { transactionLimits } from "../src/lib/protocol/transaction-limits";
import {
  protocolLookupAddresses,
  protocolLookupTables,
} from "../src/lib/protocol/lookup";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import { assertMainnet } from "../src/lib/solana";
import {
  program,
  pda,
  ata,
  integer,
  common,
  USDC_KEY,
} from "../src/lib/protocol/client";
import { vaultAccounts } from "../src/lib/protocol/kamino";
import { safeError } from "../src/lib/protocol/errors";
import stocks from "../config/mainnet-manifest.json";
import { stockSwap } from "../services/solver/market";
async function main() {
  const c = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  await assertMainnet(c);
  const addresses = JSON.parse(
    await readFile(".secrets/public-addresses.json", "utf8"),
  );
  const id = new PublicKey(process.env.STOCKROOM_PROGRAM_ID!),
    owner = new PublicKey(addresses.admin.address);
  const client = program(c, id),
    config = pda(id, "config"),
    manifest = pda(id, "manifest", 1n),
    position = pda(id, "position", owner, 1n);
  const vault = await vaultAccounts(
    c,
    new PublicKey(process.env.STOCKROOM_VAULT!),
    position,
  );
  const sharesMint = new PublicKey(vault.state.sharesMint),
    treasury = ata(new PublicKey(process.env.STOCKROOM_TREASURY_OWNER!));
  const table = (await c.getAddressLookupTable(vault.lookupTable)).value;
  if (!table) throw Error("Configured vault lookup table is unavailable");
  const base = {
    actor: owner,
    config,
    position,
    manifest,
    usdc: USDC_KEY,
    ownerCash: ata(owner),
    cash: ata(position),
    sharesMint,
    shares: ata(position, sharesMint),
    treasury,
    tokenProgram: common.tokenProgram,
  };
  const setup = createAssociatedTokenAccountIdempotentInstruction(
    owner,
    ata(owner),
    owner,
    USDC_KEY,
  );
  const latest = await c.getLatestBlockhash();
  const rows: {
    action: string;
    bytes: number;
    fits: boolean;
    accounts: number;
  }[] = [];
  function check(
    action: string,
    instructions: TransactionInstruction[],
    tables: AddressLookupTableAccount[] = [table!],
    payer: PublicKey = owner,
  ) {
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
          ...(payer.equals(owner) ? [setup] : []),
          ...instructions,
        ],
      }).compileToV0Message(tables),
    );
    const limits = transactionLimits(tx.message);
    if (limits.fits && tx.serialize().length !== limits.bytes)
      throw Error("Packet size mismatch");
    rows.push({ action, ...limits });
  }
  check("deposit", [
    await client.methods
      .createPosition(integer(1), integer(10000000), integer(1), {
        kind: { earn: {} },
        destination: { packs: {} },
        autoPacks: true,
        stockIndex: 0,
        targetPrice: integer(0),
        steps: 12,
        intervalSeconds: 86400,
        expiresAt: integer(Math.floor(Date.now() / 1000) + 2592000),
        slippageBps: 50,
      })
      .accountsStrict({
        owner,
        config,
        manifest,
        position,
        ownerCash: ata(owner),
        cash: ata(position),
        sharesMint,
        shares: ata(position, sharesMint),
        ...common,
      })
      .remainingAccounts(vault.deposit)
      .instruction(),
  ]);
  check("withdraw", [
    await client.methods
      .withdrawPrincipal(
        integer(10000000),
        vault.withdraw.length,
        integer(1),
        integer(0),
      )
      .accountsStrict(base)
      .remainingAccounts([...vault.withdraw, ...vault.deposit])
      .instruction(),
  ]);
  check("cancel", [
    await client.methods
      .cancelOrder(vault.withdraw.length, integer(1))
      .accountsStrict(base)
      .remainingAccounts(vault.withdraw)
      .instruction(),
  ]);
  check("harvest", [
    await client.methods
      .harvest(vault.withdraw.length, integer(1), integer(1))
      .accountsStrict(base)
      .remainingAccounts([...vault.withdraw, ...vault.deposit])
      .instruction(),
  ]);
  if (process.argv.includes("--routes")) {
    const configuredTables = await protocolLookupTables(c);
    const candidateKeys = protocolLookupAddresses(
      id,
      BigInt(stocks.version),
      new PublicKey(process.env.STOCKROOM_TREASURY_OWNER!),
      new PublicKey(addresses.solver.address),
      stocks.stocks,
      [...vault.deposit, ...vault.withdraw],
      [position, ata(position), ata(position, sharesMint)],
    );
    const protocolTables = process.argv.includes("--candidate-table")
      ? [
          new AddressLookupTableAccount({
            key: pda(id, "packet-lookup"),
            state: {
              deactivationSlot: 18446744073709551615n,
              lastExtendedSlot: 0,
              lastExtendedSlotStartIndex: 0,
              addresses: candidateKeys,
            },
          }),
        ]
      : configuredTables;
    const solver = new PublicKey(addresses.solver.address);
    for (const spec of stocks.stocks) {
      const mint = new PublicKey(spec.mint),
        tokenProgram = new PublicKey(spec.tokenProgram);
      const route = await stockSwap(c, solver, mint, 9800000n, 1n, 16);
      const transfer = await createTransferCheckedWithTransferHookInstruction(
        c,
        ata(solver, mint, tokenProgram),
        mint,
        ata(owner, mint, tokenProgram),
        solver,
        1n,
        spec.decimals,
        [],
        "confirmed",
        tokenProgram,
      );
      const hooks = transfer.keys.slice(4);
      const stockPrice = pda(id, "packet-stock-price", mint),
        usdcPrice = pda(id, "packet-usdc-price"),
        pack = pda(id, "pack", position, 1n);
      const setup = [
        createAssociatedTokenAccountIdempotentInstruction(
          solver,
          ata(owner),
          owner,
          USDC_KEY,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          solver,
          ata(owner, mint, tokenProgram),
          owner,
          mint,
          tokenProgram,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          solver,
          ata(solver),
          solver,
          USDC_KEY,
        ),
      ];
      const packIx = await client.methods
        .settlePack(integer(1))
        .accountsStrict({
          solver,
          config,
          pack,
          manifest,
          usdc: USDC_KEY,
          packCash: ata(pack),
          solverCash: ata(solver),
          treasury,
          stockMint: mint,
          solverStock: ata(solver, mint, tokenProgram),
          ownerStock: ata(owner, mint, tokenProgram),
          stockProgram: tokenProgram,
          stockPrice,
          usdcPrice,
          tokenProgram: common.tokenProgram,
        })
        .remainingAccounts(hooks)
        .instruction();
      check(
        `pack:${spec.ticker}`,
        [...setup, ...route.instructions, packIx],
        [...protocolTables, ...route.tables],
        solver,
      );
      const withdrawal = vault.withdrawGroups[0];
      const fillIx = await client.methods
        .fillOrder(
          integer(1),
          withdrawal.length,
          integer(1),
          integer(0),
          hooks.length,
        )
        .accountsStrict({
          base: { ...base, actor: solver },
          stockMint: mint,
          solverStock: ata(solver, mint, tokenProgram),
          ownerStock: ata(owner, mint, tokenProgram),
          stockProgram: tokenProgram,
          stockPrice,
          usdcPrice,
          solverCash: ata(solver),
        })
        .remainingAccounts([...withdrawal, ...vault.deposit, ...hooks])
        .instruction();
      check(
        `order:${spec.ticker}`,
        [...setup, ...route.instructions, fillIx],
        [...protocolTables, table, ...route.tables],
        solver,
      );
      console.log(JSON.stringify(rows.slice(-2)));
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
  }
  const report = {
    observedAt: new Date().toISOString(),
    candidateTable: process.argv.includes("--candidate-table"),
    note: "Read-only packet compilation against real mainnet vault accounts and lookup table. No simulation, signature or transaction submission; resource PDAs are illustrative.",
    program: id.toBase58(),
    vaultLookupTable: vault.lookupTable.toBase58(),
    reserveGroups: vault.state.vaultAllocationStrategy.filter(
      (a) => a.reserve !== PublicKey.default.toBase58(),
    ).length,
    results: rows,
  };
  await mkdir(".cache", { recursive: true });
  await writeFile(
    ".cache/mainnet-packets.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (rows.some((r) => !r.fits)) process.exitCode = 1;
}
main().catch((e) => {
  console.error(safeError(e, "Packet verification failed"));
  process.exitCode = 1;
});
