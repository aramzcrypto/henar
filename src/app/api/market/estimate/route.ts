import { estimateInput } from "@/lib/indicative-quote";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connection, verifiedMint } from "@/lib/solana";
import { stocks, USDC } from "@/lib/registry";
import { parseUnits, formatUnits } from "@/lib/amount";
import { safeError } from "@/lib/protocol/errors";
export async function POST(request: Request) {
  try {
    const p = z
      .object({
        inputMint: z.string(),
        outputMint: z.string(),
        amount: z.string().max(30),
        exactOutput: z.boolean(),
      })
      .parse(await request.json());
    if (
      p.inputMint === p.outputMint ||
      !stocks.some((s) => s.mint === p.inputMint || s.mint === p.outputMint)
    )
      throw new Error("Choose a supported stock pair.");
    if (!process.env.JUPITER_API_KEY)
      throw new Error("Quotes are not configured.");
    const c = connection();
    const [input, output] = await Promise.all([
      verifiedMint(c, p.inputMint),
      verifiedMint(c, p.outputMint),
    ]);
    const inputFee =
      p.inputMint === USDC ||
      (p.outputMint !== USDC && stocks.some((s) => s.mint === p.inputMint));
    const raw = parseUnits(
      p.amount,
      p.exactOutput ? output.decimals : input.decimals,
    );
    if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
    const gross = (n: bigint) => (n * 10000n + 9974n) / 9975n;
    const amount = p.exactOutput
      ? inputFee
        ? raw
        : gross(raw)
      : inputFee
        ? raw - (raw * 25n) / 10000n
        : raw;
    async function quote(amount: bigint) {
      if (amount <= 0n || amount > 18446744073709551615n)
        throw new Error("Amount is outside the supported range.");
      const params = new URLSearchParams({
        inputMint: p.inputMint,
        outputMint: p.outputMint,
        amount: amount.toString(),
        swapMode: "ExactIn",
        slippageBps: "50",
        instructionVersion: "V2",
        maxAccounts: "48",
      });
      const res = await fetch(`https://api.jup.ag/swap/v1/quote?${params}`, {
        headers: { "x-api-key": process.env.JUPITER_API_KEY! },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("No route available. Try another amount.");
      const q = z
        .object({
          inputMint: z.string(),
          outputMint: z.string(),
          inAmount: z.string().regex(/^\d+$/),
          outAmount: z.string().regex(/^\d+$/),
          swapMode: z.literal("ExactIn"),
        })
        .parse(await res.json());
      if (
        q.inputMint !== p.inputMint ||
        q.outputMint !== p.outputMint ||
        q.inAmount !== amount.toString() ||
        BigInt(q.outAmount) <= 0n
      )
        throw new Error("Quote mismatch.");
      return q;
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
              ? gross(BigInt(q.inAmount))
              : BigInt(q.inAmount)
            : raw,
          input.decimals,
        ),
        output: formatUnits(
          p.exactOutput
            ? raw
            : inputFee
              ? BigInt(q.outAmount)
              : BigInt(q.outAmount) - (BigInt(q.outAmount) * 25n) / 10000n,
          output.decimals,
        ),
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
  if (!stocks.some((s) => s.mint === mint) || !process.env.JUPITER_API_KEY)
    return NextResponse.json({ price: null });
  try {
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${mint},${USDC}`, {
      headers: { "x-api-key": process.env.JUPITER_API_KEY },
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("Price unavailable");
    const data = await res.json();
    const price = data[mint!]?.usdPrice,
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
