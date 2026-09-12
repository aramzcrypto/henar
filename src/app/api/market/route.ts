import { assertTransactionLimits } from "@/lib/protocol/transaction-limits";
import { protocolLookupTables } from "@/lib/protocol/lookup";
import { NextResponse } from "next/server";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import { z } from "zod";
import { connection, assertMainnet, verifiedMint } from "@/lib/solana";
import { stocks, USDC } from "@/lib/registry";
import {
  SOL_MINT,
  paymentLabel,
  resolveFeeAccount,
  accountFunding,
} from "@/lib/payment-tokens";
import { safeError } from "@/lib/protocol/errors";
import { parseUnits } from "@/lib/amount";
import { buildSchema, instructionSchema, marketAmounts } from "@/lib/market";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const input = z
      .object({
        mint: z.string(),
        inputMint: z.string().default(USDC),
        mode: z.literal("market").default("market"),
        owner: z.string(),
        amount: z.string().max(30),
      })
      .parse(await request.json());
    if (
      !stocks.some((s) => s.mint === input.mint || s.mint === input.inputMint)
    )
      throw new Error("Unsupported stock pair.");
    const owner = new PublicKey(input.owner);
    new PublicKey(input.inputMint);
    if (input.inputMint === input.mint)
      throw new Error("Choose a different payment token.");
    const preliminary = parseUnits(
      input.amount,
      input.inputMint === USDC
        ? 6
        : input.inputMint === SOL_MINT
          ? 9
          : (input.amount.split(".")[1]?.length ?? 0),
    );
    if (preliminary <= 0n)
      throw new Error("Enter an amount greater than zero.");
    if (
      !process.env.JUPITER_API_KEY ||
      (!process.env.STOCKROOM_FEE_ACCOUNT &&
        !process.env.STOCKROOM_FEE_ACCOUNTS &&
        !process.env.STOCKROOM_TREASURY_OWNER)
    )
      return NextResponse.json(
        {
          error:
            "Trading is not configured. Jupiter access and protocol fee accounts are required.",
        },
        { status: 503 },
      );
    const c = connection();
    await assertMainnet(c);
    const mint = await verifiedMint(c, input.mint);
    const payment = await verifiedMint(c, input.inputMint);
    const amount = parseUnits(input.amount, payment.decimals);
    const configuredFees = z
      .record(z.string())
      .parse(JSON.parse(process.env.STOCKROOM_FEE_ACCOUNTS || "{}"));
    if (process.env.STOCKROOM_TREASURY_OWNER) {
      const treasury = new PublicKey(process.env.STOCKROOM_TREASURY_OWNER);
      configuredFees[input.mint] ??= getAssociatedTokenAddressSync(
        new PublicKey(input.mint),
        treasury,
        true,
        new PublicKey(mint.program),
      ).toBase58();
      if (
        input.inputMint === USDC ||
        (input.mint !== USDC && stocks.some((s) => s.mint === input.inputMint))
      )
        configuredFees[input.inputMint] ??= getAssociatedTokenAddressSync(
          new PublicKey(input.inputMint),
          treasury,
          true,
          new PublicKey(payment.program),
        ).toBase58();
    }
    if (input.inputMint === SOL_MINT) delete configuredFees[SOL_MINT];
    const feeConfig = resolveFeeAccount(
      input.inputMint,
      input.mint,
      configuredFees,
      process.env.STOCKROOM_FEE_ACCOUNT,
    );
    const feeAccount = new PublicKey(feeConfig.address);
    const feeMint = feeConfig.mint === input.inputMint ? payment : mint;
    const fee = await getAccount(
      c,
      feeAccount,
      "confirmed",
      new PublicKey(feeMint.program),
    );
    if (!fee.mint.equals(new PublicKey(feeConfig.mint)))
      throw new Error("Protocol fee account mint mismatch.");
    const accounts = await c.getParsedTokenAccountsByOwner(owner, {
      mint: new PublicKey(input.inputMint),
    });
    const balance =
      input.inputMint === SOL_MINT
        ? BigInt(await c.getBalance(owner))
        : accounts.value.reduce(
            (total, a) =>
              total + BigInt(a.account.data.parsed.info.tokenAmount.amount),
            0n,
          );
    if (balance < amount)
      throw new Error(`Insufficient ${paymentLabel(input.inputMint)} balance.`);
    const inputFee = feeConfig.mint === input.inputMint;
    const swapAmount = inputFee ? amount - (amount * 25n) / 10000n : amount;
    if (swapAmount <= 0n) throw new Error("Trade amount is too small.");
    const params = new URLSearchParams({
      inputMint: input.inputMint,
      outputMint: input.mint,
      amount: swapAmount.toString(),
      taker: owner.toBase58(),
      slippageBps: "50",
      instructionVersion: "V2",
      maxAccounts: "48",
      wrapAndUnwrapSol: "true",
    });
    const res = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
      headers: { "x-api-key": process.env.JUPITER_API_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new Error(
        res.status === 429
          ? "Quote service is busy. Try again shortly."
          : "No executable route is available.",
      );
    const build = buildSchema.parse(await res.json());
    if (
      build.inputMint !== input.inputMint ||
      build.outputMint !== input.mint ||
      build.inAmount !== swapAmount.toString() ||
      build.slippageBps !== 50 ||
      (build.platformFee && build.platformFee.feeBps !== 0) ||
      BigInt(build.outAmount) <= 0n ||
      BigInt(build.otherAmountThreshold) <= 0n
    )
      throw new Error("Quote terms failed validation.");
    const toInstruction = (ix: z.infer<typeof instructionSchema>) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((a) => ({
          ...a,
          pubkey: new PublicKey(a.pubkey),
        })),
        data: Buffer.from(ix.data, "base64"),
      });
    const lookupTables = await Promise.all(
      Object.keys(build.addressesByLookupTableAddress ?? {}).map(
        async (key) => {
          const table = await c.getAddressLookupTable(new PublicKey(key));
          if (!table.value) throw new Error("Routing table is unavailable.");
          return table.value;
        },
      ),
    );
    lookupTables.push(...(await protocolLookupTables(c)));
    const terms = marketAmounts(
      amount,
      BigInt(build.outAmount),
      BigInt(build.otherAmountThreshold),
      inputFee,
    );
    const feeTransfer =
      terms.fee > 0n
        ? await createTransferCheckedWithTransferHookInstruction(
            c,
            getAssociatedTokenAddressSync(
              new PublicKey(feeConfig.mint),
              owner,
              false,
              new PublicKey(feeMint.program),
            ),
            new PublicKey(feeConfig.mint),
            feeAccount,
            owner,
            terms.fee,
            feeMint.decimals,
            [],
            "confirmed",
            new PublicKey(feeMint.program),
          )
        : null;
    const latest = await c.getLatestBlockhash();
    // Fixed, disclosed priority price prevents an upstream fee estimate from spiking.
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ...build.setupInstructions.map(toInstruction),
      toInstruction(build.swapInstruction),
      ...(build.cleanupInstruction
        ? [toInstruction(build.cleanupInstruction)]
        : []),
      ...build.otherInstructions.map(toInstruction),
      ...(feeTransfer ? [feeTransfer] : []),
    ];
    const message = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: latest.blockhash,
      instructions,
    }).compileToV0Message(lookupTables);
    assertTransactionLimits(message);
    const tx = new VersionedTransaction(message);
    if (message.header.numRequiredSignatures !== 1)
      throw new Error("Unsupported additional transaction signer.");
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(input.mint),
      owner,
      false,
      new PublicKey(mint.program),
    );
    const simulation = await c.simulateTransaction(tx, {
      sigVerify: false,
      accounts: {
        encoding: "base64",
        addresses: [owner.toBase58(), ata.toBase58()],
      },
    });
    if (simulation.value.err)
      throw new Error(
        "Transaction simulation failed. Check SOL, payment balance and token eligibility.",
      );
    const network = await c.getFeeForMessage(message);
    if (network.value === null) throw new Error("Network fee unavailable.");
    const before = await c.getBalance(owner);
    const after = simulation.value.accounts?.[0]?.lamports;
    if (after === undefined || after === null)
      throw new Error("Could not verify transaction costs.");
    const rent =
      accountFunding(
        BigInt(before),
        BigInt(after),
        BigInt(network.value),
        input.inputMint,
        amount,
      ) + (input.mint === SOL_MINT ? BigInt(build.outAmount) : 0n);
    if (rent < 0n) throw new Error("Unexpected SOL balance change.");
    return NextResponse.json(
      {
        transaction: Buffer.from(tx.serialize()).toString("base64"),
        ...latest,
        expiresAt: Date.now() + 20000,
        owner: input.owner,
        mint: input.mint,
        inputMint: input.inputMint,
        inputDecimals: payment.decimals,
        feeMint: feeConfig.mint,
        feeDecimals: feeMint.decimals,
        amount: amount.toString(),
        outAmount: terms.receive.toString(),
        minimum: terms.minReceive.toString(),
        decimals: mint.decimals,
        protocolFee: terms.fee.toString(),
        networkFee: String(network.value),
        rent: rent.toString(),
        priceImpactPct: build.priceImpactPct,
        balance: balance.toString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid request or quote data."
            : safeError(error, "Quote unavailable."),
      },
      { status: 400 },
    );
  }
}
