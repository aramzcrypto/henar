/**
 * Which assets an automatic route may pass through.
 *
 * A user may choose any supported asset as an endpoint. An intermediate is
 * chosen for them, so it carries a different burden: if the middle of a route
 * is thin, the hop loses money in two pools instead of one. The question is
 * not whether an asset is famous, it is whether it is liquid enough to carry
 * the size, so this qualifies assets by measurement rather than by a list of
 * names.
 *
 * The measurement is a round trip. Ten thousand dollars of USDC is quoted into
 * the asset and straight back out, and what fails to return is the cost of
 * using it as a bridge at that size, in both directions at once. An asset that
 * cannot be quoted, cannot be verified, or whose token semantics we cannot
 * settle is excluded before the probe runs.
 *
 *   npm run router:qualify:intermediates
 */
import { readFile, writeFile } from "node:fs/promises";
import { USDC_MINT, listRouterRepresentations, verifiedMint } from "@henar/router-core";
import { quoteJupiter } from "@/lib/execution/adapters/jupiter";
import { createLimiter } from "./rate-limit";

const OUTPUT = "src/data/router/intermediates.json";
const DISCOVERY = ["src/data/router/orca-discovery.json", "src/data/router/raydium-discovery.json"];
const PROBE_USD = Number(process.env.INTERMEDIATE_PROBE_USD ?? "10000");
const MAX_LOSS_BPS = Number(process.env.INTERMEDIATE_MAX_LOSS_BPS ?? "100");

export type IntermediateAsset = {
  mint: string;
  symbol: string | null;
  decimals: number;
  tokenProgram: string;
  /** What a round trip through this asset costs at the probe size, in bps. */
  roundTripLossBps: number | null;
  qualified: boolean;
  reason: string;
  probedAt: string;
};

async function main() {
  const symbols = new Map(listRouterRepresentations().map((rep) => [rep.mint, rep.tokenSymbol]));
  const candidates = new Set<string>([USDC_MINT]);
  for (const file of DISCOVERY) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as { pools?: { counterMint?: string }[] };
      for (const pool of raw.pools ?? []) if (pool.counterMint) candidates.add(pool.counterMint);
    } catch {
      // A missing dump contributes nothing.
    }
  }
  const mints = [...candidates].sort();
  process.stdout.write(`${mints.length} candidate intermediates, probing ${PROBE_USD} USD round trips\n`);

  // Jupiter is asked twice per candidate; pace it so a burst is not mistaken
  // for a liquidity failure.
  const limit = createLimiter({ minIntervalMs: Number(process.env.INTERMEDIATE_INTERVAL_MS ?? "700"), retries: 4 });
  const probeRaw = BigInt(Math.round(PROBE_USD * 1_000_000));
  const assets: IntermediateAsset[] = [];
  const at = new Date().toISOString();

  for (const mint of mints) {
    const facts = verifiedMint(mint);
    const symbol = symbols.get(mint) ?? null;
    const base = { mint, symbol, probedAt: at };
    if (mint === USDC_MINT) {
      assets.push({ ...base, decimals: 6, tokenProgram: facts?.tokenProgram ?? "", roundTripLossBps: 0, qualified: true, reason: "the quote asset itself" });
      continue;
    }
    if (!facts) {
      assets.push({ ...base, decimals: -1, tokenProgram: "", roundTripLossBps: null, qualified: false, reason: "mint not verified" });
      continue;
    }
    if (!facts.supported) {
      assets.push({ ...base, decimals: facts.decimals, tokenProgram: facts.tokenProgram, roundTripLossBps: null, qualified: false, reason: `token semantics unsupported: ${facts.unsupportedReason}` });
      continue;
    }
    try {
      const into = await limit(() => quoteJupiter({ inputMint: USDC_MINT, outputMint: mint, amount: probeRaw, slippageBps: 50 }));
      const received = BigInt(into.outputAmount);
      if (received <= 0n) throw new Error("no output");
      const back = await limit(() => quoteJupiter({ inputMint: mint, outputMint: USDC_MINT, amount: received, slippageBps: 50 }));
      const returned = BigInt(back.outputAmount);
      const lossBps = Number(((probeRaw - returned) * 10_000n) / probeRaw);
      const qualified = lossBps <= MAX_LOSS_BPS;
      assets.push({
        ...base,
        decimals: facts.decimals,
        tokenProgram: facts.tokenProgram,
        roundTripLossBps: lossBps,
        qualified,
        reason: qualified
          ? `round trip of ${PROBE_USD} USD costs ${lossBps} bps`
          : `round trip of ${PROBE_USD} USD costs ${lossBps} bps, above the ${MAX_LOSS_BPS} bps ceiling`,
      });
    } catch (error) {
      assets.push({
        ...base,
        decimals: facts.decimals,
        tokenProgram: facts.tokenProgram,
        roundTripLossBps: null,
        qualified: false,
        reason: `not quotable at ${PROBE_USD} USD: ${(error as Error).message}`,
      });
    }
    const last = assets[assets.length - 1];
    process.stdout.write(`  ${(last.symbol ?? last.mint.slice(0, 10)).padEnd(12)} ${last.qualified ? "QUALIFIED" : "excluded "} ${last.reason}\n`);
  }

  assets.sort((a, b) => a.mint.localeCompare(b.mint));
  await writeFile(
    OUTPUT,
    `${JSON.stringify({ generatedAt: at, probeNotionalUsd: PROBE_USD, maxRoundTripLossBps: MAX_LOSS_BPS, assets }, null, 2)}\n`,
    "utf8",
  );
  const passed = assets.filter((a) => a.qualified);
  process.stdout.write(`\n${passed.length} of ${assets.length} assets qualified as automatic intermediates\n`);
  for (const asset of passed.slice().sort((a, b) => (a.roundTripLossBps ?? 0) - (b.roundTripLossBps ?? 0)))
    process.stdout.write(`  ${(asset.symbol ?? asset.mint.slice(0, 12)).padEnd(14)} ${String(asset.roundTripLossBps).padStart(5)} bps  ${asset.mint}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
