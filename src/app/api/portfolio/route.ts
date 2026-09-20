import Decimal from "decimal.js";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connection, assertMainnet } from "@/lib/solana";
import { SOL_MINT } from "@/lib/payment-tokens";
import { consumeRelayBudget } from "@/lib/equities/rate-limit";
export async function GET(req: Request) {
  /* Two getParsedTokenAccountsByOwner calls per request against a paid RPC,
     for any owner the caller names. Without a bound, wallet enumeration runs
     on our quota. */
  if (!consumeRelayBudget(req))
    return NextResponse.json(
      { error: "Rate limit reached. Please wait a minute." },
      { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  try {
    const owner = new PublicKey(
      new URL(req.url).searchParams.get("owner") ?? "",
    );
    const c = connection();
    await assertMainnet(c);
    const results = await Promise.all(
      [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
        c.getParsedTokenAccountsByOwner(owner, { programId }),
      ),
    );
    const balances: Record<
      string,
      { amount: string; decimals: number; uiAmount?: string }
    > = {};
    for (const result of results)
      for (const account of result.value) {
        const info = account.account.data.parsed.info;

        balances[info.mint] = {
          amount: (
            BigInt(balances[info.mint]?.amount ?? "0") +
            BigInt(info.tokenAmount.amount)
          ).toString(),
          decimals: info.tokenAmount.decimals,
          uiAmount: new Decimal(balances[info.mint]?.uiAmount ?? "0")
            .add(
              info.tokenAmount.uiAmountString ??
                new Decimal(info.tokenAmount.amount).div(
                  new Decimal(10).pow(info.tokenAmount.decimals),
                ),
            )
            .toFixed(),
        };
      }
    balances[SOL_MINT] = {
      amount: String(await c.getBalance(owner)),
      decimals: 9,
    };
    return NextResponse.json(
      { balances, asOf: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error: "Balances unavailable. Check your mainnet connection.",
      },
      { status: 503 },
    );
  }
}
