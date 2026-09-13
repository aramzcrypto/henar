import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson } from "@/lib/request-body";
import { aggregateExecutionQuotes } from "@/lib/execution/aggregate";
import { consumePublicQuoteBudget } from "@/lib/equities/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+$/),
  slippageBps: z.number().int().min(1).max(100).default(50),
});

export async function POST(request: Request) {
  if (!consumePublicQuoteBudget(request))
    return NextResponse.json(
      { error: "Quote limit reached. Please wait a minute." },
      {
        status: 429,
        headers: { "Cache-Control": "private, no-store", "Retry-After": "60" },
      },
    );
  try {
    const input = schema.parse(await boundedJson(request));
    const result = await aggregateExecutionQuotes({
      ...input,
      amount: BigInt(input.amount),
    });
    return NextResponse.json(result, {
      status: result.selected ? 200 : 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid quote request." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
