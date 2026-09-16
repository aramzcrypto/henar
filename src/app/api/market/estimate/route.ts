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
import { fairValueForMint } from "@/lib/pyth/company";
import { routerEngineQuote } from "@/lib/private-markets/liquidity";
import { routerRepresentationForMint } from "@henar/router-core";
import { executablePriceFrom } from "@/lib/pyth/fair-value";
import { henarFlag } from "@/lib/feature-flags";
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
      let q = aggregate.selected;
      /* Private-market products trade on venues the HTTP aggregators may not
         index. Henar's own engine quotes their verified pools from chain, so
         it is the backstop for exactly those pairs — never a substitute for a
         public equity's aggregator comparison, which is unchanged. */
      if (!q) {
        const privateMint = [p.inputMint, p.outputMint].find((m) => routerRepresentationForMint(m)?.assetClass === "PRIVATE_MARKET_EXPOSURE");
        const side = p.inputMint === USDC ? ("buy" as const) : p.outputMint === USDC ? ("sell" as const) : null;
        if (privateMint && side) {
          const engine = await routerEngineQuote(privateMint, side, amount).catch(() => null);
          if (engine)
            q = {
              source: "henar-router" as never,
              quoteProvider: "henar-router" as never,
              quoteId: null,
              inputMint: p.inputMint,
              outputMint: p.outputMint,
              inputAmount: engine.inputAmount,
              grossOutputAmount: engine.grossOutputAmount,
              outputAmount: engine.outputAmount,
              minimumOutputAmount: engine.minimumOutputAmount,
              providerFeeBps: 0,
              providerFeeAmount: "0",
              priceImpactPct: engine.priceImpactPct,
              route: engine.route,
              contextSlot: null,
              quotedAt: engine.quotedAt,
              expiresAt: engine.expiresAt,
              transactionAvailable: false,
              /* Henar's own engine, used as the backstop for private-market
                 pairs the HTTP aggregators do not index. The router builds
                 and submits this route itself, so unlike OpenOcean or Titan
                 it is a quote the user can actually be given. */
              fillable: true,
            };
        }
      }
      if (!q) throw new Error("No route available. Try another amount.");
      const candidates = aggregate.candidates.length ? aggregate.candidates : [q];
      return {
        inAmount: q.inputAmount,
        outAmount: q.outputAmount,
        executionSource: q.source,
        quoteProvider: q.quoteProvider,
        route: q.route,
        alternatives: candidates.length,
        candidates,
        quotedAt: aggregate.quotedAt,
        expiresAt: aggregate.expiresAt,
      };
    }
    // Solve an indicative input using fresh routes. Execution still requires a new ExactIn review.
    const q = p.exactOutput
      ? await estimateInput(amount, 10n ** BigInt(input.decimals), quote)
      : await quote(amount);
    const inputDisplay = formatUnits(
      p.exactOutput
        ? inputFee
          ? grossForNet(BigInt(q.inAmount))
          : BigInt(q.inAmount)
        : raw,
      input.decimals,
    );
    const outputDisplay = formatUnits(
      p.exactOutput
        ? raw
        : inputFee
          ? BigInt(q.outAmount)
          : BigInt(q.outAmount) - tradeFee(BigInt(q.outAmount)),
      output.decimals,
    );
    /* Pyth fair value for a USDC ↔ representation pair: the venue price
       (before the Henar fee, USDC per display unit) against the Pyth
       tokenized and underlying references. Never delays or fails the quote. */
    const pyth = henarFlag("pythPro")
      ? await (async () => {
          const side = p.inputMint === USDC ? ("buy" as const) : p.outputMint === USDC ? ("sell" as const) : null;
          if (!side) return null;
          const usdc = formatUnits(BigInt(side === "buy" ? q.inAmount : q.outAmount), 6);
          const token = formatUnits(BigInt(side === "buy" ? q.outAmount : q.inAmount), side === "buy" ? output.decimals : input.decimals);
          const price = executablePriceFrom(usdc, token);
          if (!price) return null;
          return fairValueForMint(side === "buy" ? p.outputMint : p.inputMint, { price, side, source: `${q.executionSource} quote`, quotedAt: q.quotedAt }).catch(() => null);
        })()
      : null;
    return NextResponse.json(
      {
        input: inputDisplay,
        output: outputDisplay,
        pyth,
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
