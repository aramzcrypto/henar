import { boundedJson } from "@/lib/request-body";
import { estimateInput } from "@/lib/indicative-quote";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connection, verifiedMint } from "@/lib/solana";
import { USDC } from "@/lib/registry";
import { parseUnits, formatUnits } from "@/lib/amount";
import { safeError } from "@/lib/protocol/errors";
import { aggregateIndicativeQuotes } from "@/lib/execution/aggregate";
import { consumePublicQuoteBudget } from "@/lib/equities/rate-limit";
import { MARKET_FEE_BPS, grossForNet, tradeFee } from "@/lib/trade-fee";
import { feeOnInput } from "@/lib/payment-tokens";
export async function POST(request: Request) {
  try {
    if (!consumePublicQuoteBudget(request))
      return NextResponse.json(
        { error: "Quote limit reached. Please wait a minute." },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "60" },
        },
      );
    const p = z
      .object({
        inputMint: z.string(),
        outputMint: z.string(),
        amount: z.string().max(30),
        exactOutput: z.boolean(),
      })
      .parse(await boundedJson(request));
    if (p.inputMint === p.outputMint)
      throw new Error("Choose two different assets.");
    const c = connection();
    const [input, output] = await Promise.all([
      verifiedMint(c, p.inputMint),
      verifiedMint(c, p.outputMint),
    ]);
    const inputFee = feeOnInput(p.inputMint, p.outputMint);
    const raw = parseUnits(
      p.amount,
      p.exactOutput ? output.decimals : input.decimals,
    );
    if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
    const amount = p.exactOutput
      ? inputFee
        ? raw
        : grossForNet(raw)
      : inputFee
        ? raw - tradeFee(raw)
        : raw;
    async function quote(amount: bigint) {
      if (amount <= 0n || amount > 18446744073709551615n)
        throw new Error("Amount is outside the supported range.");
      const aggregate = await aggregateIndicativeQuotes({
        inputMint: p.inputMint,
        outputMint: p.outputMint,
        amount,
        slippageBps: 50,
      });
      const q = aggregate.selected;
      if (!q) throw new Error("No route available. Try another amount.");
      return {
        inAmount: q.inputAmount,
        outAmount: q.outputAmount,
        executionSource: q.source,
        quoteProvider: q.quoteProvider,
        route: q.route,
        alternatives: aggregate.candidates.length,
        candidates: aggregate.candidates,
        quotedAt: aggregate.quotedAt,
        expiresAt: aggregate.expiresAt,
      };
    }
    // Solve an indicative input using fresh routes. Execution still requires a new ExactIn review.
    const q = p.exactOutput
      ? await estimateInput(amount, 10n ** BigInt(input.decimals), quote)
      : await quote(amount);
    return NextResponse.json(
      {
        input: formatUnits(
          p.exactOutput
            ? inputFee
              ? grossForNet(BigInt(q.inAmount))
              : BigInt(q.inAmount)
            : raw,
          input.decimals,
        ),
        output: formatUnits(
          p.exactOutput
            ? raw
            : inputFee
              ? BigInt(q.outAmount)
              : BigInt(q.outAmount) - tradeFee(BigInt(q.outAmount)),
          output.decimals,
        ),
        executionSource: q.executionSource,
        quoteProvider: q.quoteProvider,
        route: q.route,
        alternatives: q.alternatives,
        candidates: q.candidates.map((candidate) => {
          const rawOutput = BigInt(candidate.outputAmount);
          const netOutput = inputFee
            ? rawOutput
            : rawOutput - tradeFee(rawOutput);
          const rawMinimum = BigInt(candidate.minimumOutputAmount);
          const netMinimum = inputFee
            ? rawMinimum
            : rawMinimum - tradeFee(rawMinimum);
          return {
            source: candidate.source,
            quoteProvider: candidate.quoteProvider,
            providerFeeBps: candidate.providerFeeBps,
            providerFeeAmount: formatUnits(
              BigInt(candidate.providerFeeAmount),
              output.decimals,
            ),
            output: formatUnits(netOutput, output.decimals),
            minimumOutput: formatUnits(netMinimum, output.decimals),
            priceImpactPct: candidate.priceImpactPct,
            route: candidate.route,
            transactionAvailable: candidate.transactionAvailable,
          };
        }),
        quotedAt: q.quotedAt,
        expiresAt: q.expiresAt,
        feeBps: MARKET_FEE_BPS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "Estimate unavailable.") },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const mint = new URL(request.url).searchParams.get("mint");
  if (!mint) return NextResponse.json({ price: null });
  if (mint === USDC) return NextResponse.json({ price: 1 });
  if (!process.env.JUPITER_API_KEY)
    return NextResponse.json({ price: null });
  try {
    await verifiedMint(connection(), mint);
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${mint},${USDC}`, {
      headers: { "x-api-key": process.env.JUPITER_API_KEY },
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("Price unavailable");
    const data = await res.json();
    const price = data[mint]?.usdPrice,
      usdc = data[USDC]?.usdPrice;
    return NextResponse.json({
      price:
        typeof price === "number" &&
        price > 0 &&
        typeof usdc === "number" &&
        usdc > 0
          ? price / usdc
          : null,
    });
  } catch {
    return NextResponse.json({ price: null });
  }
}
