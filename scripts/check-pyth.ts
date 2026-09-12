/** Read-only entitlement/freshness checks; no wallet or deployed Kani program required. */
import { mkdir, writeFile } from "node:fs/promises";
import { fetchPrices } from "../services/solver/oracles";
import { PYTH_HERMES_URL, PYTH_PROGRAMS } from "../src/lib/protocol/pyth";
import manifest from "../config/mainnet-manifest.json";
async function main() {
  const feeds = [
    { ticker: "USDC", feed: manifest.usdcFeed },
    ...(process.argv.includes("--all")
      ? manifest.stocks
      : manifest.stocks.slice(0, 1)),
  ];
  const report = [];
  for (const item of feeds) {
    try {
      const result = await fetchPrices([item.feed]);
      const price = result.prices.get(item.feed)!;
      report.push({
        ticker: item.ticker,
        feed: item.feed,
        status: "accessible",
        ageSeconds: Math.floor(Date.now() / 1000) - price.publish_time,
        binaryUpdates: result.binary.length,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Oracle request failed";
      report.push({
        ticker: item.ticker,
        feed: item.feed,
        status: message.includes("403")
          ? "not-entitled"
          : message.includes("401")
            ? "unauthorized"
            : "unavailable",
      });
    }
  }
  const output = {
    observedAt: new Date().toISOString(),
    endpoint: PYTH_HERMES_URL,
    receiver: PYTH_PROGRAMS.receiverProgramId.toBase58(),
    keyConfigured: !!process.env.PYTH_API_KEY,
    checks: report,
  };
  await mkdir(".cache", { recursive: true });
  await writeFile(".cache/pyth-access.json", JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  if (report.some((r) => r.status !== "accessible")) process.exitCode = 1;
}
main().catch(() => {
  console.error("Pyth access check failed. No credentials were printed.");
  process.exitCode = 1;
});
