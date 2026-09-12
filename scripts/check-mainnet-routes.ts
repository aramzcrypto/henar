import { writeFile, readFile } from "node:fs/promises";
import { buildSchema } from "../src/lib/market";
import manifest from "../config/mainnet-manifest.json";
async function main() {
  if (!process.env.JUPITER_API_KEY) throw Error("Jupiter key missing");
  const prior = process.argv.includes("--retry")
    ? JSON.parse(await readFile(".cache/mainnet-route-report.json", "utf8"))
        .results
    : [];
  const results = [];
  for (const stock of manifest.stocks) {
    const existing = prior.find(
      (r: { mint: string; valid: boolean }) => r.mint === stock.mint && r.valid,
    );
    if (existing) {
      results.push(existing);
      continue;
    }
    const params = new URLSearchParams({
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: stock.mint,
      amount: "9800000",
      taker: process.env.STOCKROOM_TREASURY_OWNER!,
      slippageBps: "50",
      instructionVersion: "V2",
    });
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch("https://api.jup.ag/swap/v2/build?" + params, {
        headers: { "x-api-key": process.env.JUPITER_API_KEY },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status !== 429 || attempt === 3) break;
      const seconds = Number(res.headers.get("retry-after"));
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(
            60000,
            (Number.isFinite(seconds) && seconds > 0
              ? seconds
              : 10 * (attempt + 1)) * 1000,
          ),
        ),
      );
    }
    const body = await res.json();
    const parsed = buildSchema.safeParse(body);
    results.push({
      ticker: stock.ticker,
      mint: stock.mint,
      status: res.status,
      valid: res.ok && parsed.success,
      outAmount: parsed.success ? parsed.data.outAmount : undefined,
      minimum: parsed.success ? parsed.data.otherAmountThreshold : undefined,
      errorCode:
        body.errorCode ??
        body.code ??
        (parsed.success ? undefined : "response-or-route-unavailable"),
    });
    await new Promise((r) => setTimeout(r, 1500));
  }
  await writeFile(
    ".cache/mainnet-route-report.json",
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        note: "Authenticated quotes only; no funded transaction or delivery verified.",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      total: results.length,
      routes: results.filter((r) => r.valid).length,
      unavailable: results
        .filter((r) => !r.valid)
        .map((r) => ({
          ticker: r.ticker,
          status: r.status,
          error: r.errorCode,
        })),
    }),
  );
}
main().catch(() => {
  console.error(
    "Route verification failed; inspect provider availability without logging credentials.",
  );
  process.exitCode = 1;
});
