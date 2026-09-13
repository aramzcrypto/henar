import {
  inspectRouteWallet,
  verifyRouteWallet,
} from "@/lib/wallet-route-state";
import { boundedJson } from "@/lib/request-body";
import { validateWalletRoute } from "@/lib/route-policy";
import { assertTransactionLimits } from "@/lib/protocol/transaction-limits";
import { protocolLookupTables } from "@/lib/protocol/lookup";
import { NextResponse } from "next/server";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { z } from "zod";
import { connection, assertMainnet, verifiedMint } from "@/lib/solana";
import { USDC } from "@/lib/registry";
import {
  SOL_MINT,
  paymentLabel,
  resolveFeeAccount,
  accountFunding,
  feeOnInput,
} from "@/lib/payment-tokens";
import { safeError } from "@/lib/protocol/errors";
import { parseUnits } from "@/lib/amount";
import { buildSchema, marketAmounts } from "@/lib/market";
import { MARKET_FEE_BPS, tradeFee } from "@/lib/trade-fee";
import { consumeQuoteBudget, verifyQuoteAccess } from "@/lib/wallet-access-server";
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
      .parse(await boundedJson(request));
    if (!verifyQuoteAccess(request, input.owner))
      return NextResponse.json({ error: "Verify your wallet to request a trade quote." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (!consumeQuoteBudget(input.owner))
      return NextResponse.json({ error: "Quote limit reached. Please wait a minute." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
    const owner = new PublicKey(input.owner);
    new PublicKey(input.inputMint);
    new PublicKey(input.mint);
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
    const jupiterKey = process.env.JUPITER_API_KEY;
    if (
      !jupiterKey ||
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
      if (feeOnInput(input.inputMint, input.mint))
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
    let feeSetup: ReturnType<
      typeof createAssociatedTokenAccountIdempotentInstruction
    > | null = null;
    try {
      const fee = await getAccount(
        c,
        feeAccount,
        "confirmed",
        new PublicKey(feeMint.program),
      );
      if (!fee.mint.equals(new PublicKey(feeConfig.mint)))
        throw new Error("Protocol fee account mint mismatch.");
    } catch (error) {
      if (!(error instanceof TokenAccountNotFoundError)) throw error;
      if (!process.env.STOCKROOM_TREASURY_OWNER)
        throw new Error(
          "Protocol fee account is not initialized for this token.",
        );
      const treasury = new PublicKey(process.env.STOCKROOM_TREASURY_OWNER);
      const canonical = getAssociatedTokenAddressSync(
        new PublicKey(feeConfig.mint),
        treasury,
        true,
        new PublicKey(feeMint.program),
      );
      if (!feeAccount.equals(canonical))
        throw new Error(
          "Protocol fee account is not initialized for this token.",
        );
      // Create only the configured treasury's canonical ATA. Its exact rent is
      // simulated and separately disclosed before the user's signature.
      feeSetup = createAssociatedTokenAccountIdempotentInstruction(
        owner,
        canonical,
        treasury,
        new PublicKey(feeConfig.mint),
        new PublicKey(feeMint.program),
      );
    }
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
    const swapAmount = inputFee
      ? amount - tradeFee(amount, MARKET_FEE_BPS)
      : amount;
    if (swapAmount <= 0n) throw new Error("Trade amount is too small.");
    const routeTerms = {
      owner,
      inputMint: new PublicKey(input.inputMint),
      outputMint: new PublicKey(input.mint),
      inputProgram: new PublicKey(payment.program),
      outputProgram: new PublicKey(mint.program),
      amount: swapAmount,
      slippage: 50,
      nativeSol: true,
    };
    const loadRoute = async (maxAccounts: number) => {
      const params = new URLSearchParams({
        inputMint: input.inputMint,
        outputMint: input.mint,
        amount: swapAmount.toString(),
        taker: owner.toBase58(),
        slippageBps: "50",
        instructionVersion: "V2",
        maxAccounts: String(maxAccounts),
        wrapAndUnwrapSol: "true",
        useSharedAccounts: "false",
      });
      const res = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
        headers: { "x-api-key": jupiterKey },
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
      const validated = validateWalletRoute(build, routeTerms);
      const watched = await inspectRouteWallet(
        c,
        validated.instructions,
        routeTerms,
      );
      return { build, validated, watched };
    };
    let route;
    try {
      route = await loadRoute(48);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        ![
          "Route would access unrelated wallet inventory. Try another route.",
          "Route instructions do not match the reviewed trade.",
          "Too many route accounts.",
        ].includes(error.message)
      )
        throw error;
      // Requote a smaller route once; the same custody policy still applies.
      route = await loadRoute(16);
    }
    const { build, validated, watched } = route;
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
    if (terms.fee === 0n) feeSetup = null;
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
      ...validated.instructions,
      ...(feeSetup ? [feeSetup] : []),
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
        addresses: [
          owner.toBase58(),
          ...watched.map((w) => w.address),
          ...(feeSetup ? [feeAccount.toBase58()] : []),
        ],
      },
    });
    if (simulation.value.err)
      throw new Error(
        "Transaction simulation failed. Check SOL, payment balance and token eligibility.",
      );
    if (!simulation.value.accounts)
      throw new Error("Token delivery verification unavailable.");
    const received = verifyRouteWallet(
      watched,
      simulation.value.accounts.slice(1, 1 + watched.length),
      owner,
    );
    if (input.mint !== SOL_MINT) {
      const beforeOutput =
        watched.find((w) => w.address === ata.toBase58())?.before?.amount ?? 0n;
      const afterOutput = received.get(ata.toBase58())?.amount ?? 0n;
      if (afterOutput - beforeOutput < terms.minReceive)
        throw new Error(
          "Simulated stock delivery is below the reviewed minimum.",
        );
    }
    if (input.inputMint !== SOL_MINT) {
      const source = getAssociatedTokenAddressSync(
        new PublicKey(input.inputMint),
        owner,
        false,
        new PublicKey(payment.program),
      ).toBase58();
      const beforeInput =
        watched.find((w) => w.address === source)?.before?.amount ?? 0n;
      const afterInput = received.get(source)?.amount ?? 0n;
      if (beforeInput - afterInput !== amount)
        throw new Error("Simulated debit differs from the reviewed payment.");
    }
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
        route: build,
        inputProgram: payment.program,
        outputProgram: mint.program,
        feeAccount: feeAccount.toBase58(),
        feeSetupOwner: feeSetup?.keys[2].pubkey.toBase58() ?? null,
        feeInstruction: feeTransfer ? {
          programId: feeTransfer.programId.toBase58(),
          accounts: feeTransfer.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
          data: feeTransfer.data.toString("base64"),
        } : null,
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
        feeAccountRent: feeSetup
          ? String(simulation.value.accounts[1 + watched.length]?.lamports ?? 0)
          : "0",
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
