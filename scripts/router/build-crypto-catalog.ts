/**
 * The crypto assets the token selector offers.
 *
 * Any-to-any already works: the market path quotes and routes an arbitrary
 * Solana pair through Jupiter, and BONK to NVDAx returns a real price today.
 * What was missing is that a user could only pick a token they already held,
 * so the reach existed and nobody could reach it.
 *
 * This lists candidates and then lets the chain decide. Each mint is verified
 * for decimals, token program and token semantics we can settle, then probed
 * with a round trip through USDC at a realistic size. Nothing is listed on my
 * say-so: symbols and names come from token metadata, never from the candidate
 * list, so a mint I typed wrongly is shipped as whatever it actually is rather
 * than under a name it does not own, and anything that cannot be quoted is
 * dropped.
 *
 *   npm run router:build:crypto
 */
import { readFile, writeFile } from "node:fs/promises";
import { USDC_MINT, verifiedMint } from "@henar/router-core";
import { tokenMetadata } from "@/lib/token-metadata";
import { quoteJupiter } from "@/lib/execution/adapters/jupiter";
import { createLimiter } from "./rate-limit";

const OUTPUT = "src/data/router/crypto-assets.json";
const PROBE_USD = Number(process.env.CRYPTO_PROBE_USD ?? "2000");
const MAX_LOSS_BPS = Number(process.env.CRYPTO_MAX_LOSS_BPS ?? "300");

const CANDIDATE_FILE = "src/data/router/crypto-candidates.json";

export type CryptoAsset = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  pinned: boolean;
  roundTripLossBps: number | null;
  listedReason: string;
};

async function main() {
  const limit = createLimiter({ minIntervalMs: Number(process.env.CRYPTO_INTERVAL_MS ?? "700"), retries: 4 });
  const { candidates, pinned } = JSON.parse(await readFile(CANDIDATE_FILE, "utf8")) as { candidates: string[]; pinned: string[] };
  const mints = [...new Set(candidates)];
  const metadata = new Map((await tokenMetadata(mints)).map((entry) => [entry.mint, entry]));
  const probeRaw = BigInt(Math.round(PROBE_USD * 1_000_000));
  const listed: CryptoAsset[] = [];
  const dropped: { mint: string; reason: string }[] = [];

  for (const mint of mints) {
    const facts = verifiedMint(mint);
    const meta = metadata.get(mint);
    if (!facts) {
      dropped.push({ mint, reason: "mint not verified on chain" });
      continue;
    }
    if (!facts.supported) {
      dropped.push({ mint, reason: `token semantics unsupported: ${facts.unsupportedReason}` });
      continue;
    }
    if (!meta?.symbol) {
      dropped.push({ mint, reason: "no token metadata; refusing to list an asset we cannot name" });
      continue;
    }
    let lossBps: number | null = null;
    if (mint !== USDC_MINT) {
      try {
        const into = await limit(() => quoteJupiter({ inputMint: USDC_MINT, outputMint: mint, amount: probeRaw, slippageBps: 50 }));
        const received = BigInt(into.outputAmount);
        if (received <= 0n) throw new Error("no output");
        const back = await limit(() => quoteJupiter({ inputMint: mint, outputMint: USDC_MINT, amount: received, slippageBps: 50 }));
        lossBps = Number(((probeRaw - BigInt(back.outputAmount)) * 10_000n) / probeRaw);
      } catch (error) {
        dropped.push({ mint, reason: `not quotable at ${PROBE_USD} USD: ${(error as Error).message}` });
        continue;
      }
      if (lossBps > MAX_LOSS_BPS) {
        dropped.push({ mint, reason: `round trip costs ${lossBps} bps, above the ${MAX_LOSS_BPS} bps ceiling` });
        continue;
      }
    }
    listed.push({
      mint,
      symbol: meta.symbol,
      name: meta.name ?? meta.symbol,
      decimals: facts.decimals,
      logo: meta.logo ?? null,
      pinned: pinned.includes(mint),
      roundTripLossBps: lossBps,
      listedReason: lossBps === null ? "the quote asset itself" : `round trip of ${PROBE_USD} USD costs ${lossBps} bps`,
    });
  }

  // Pinned first, in the order declared, then the rest by liquidity.
  listed.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return pinned.indexOf(a.mint) - pinned.indexOf(b.mint);
    return (a.roundTripLossBps ?? 0) - (b.roundTripLossBps ?? 0);
  });
  await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), probeNotionalUsd: PROBE_USD, assets: listed }, null, 2)}\n`, "utf8");

  process.stdout.write(`${listed.length} of ${mints.length} candidates listed\n`);
  for (const asset of listed)
    process.stdout.write(`  ${asset.pinned ? "pinned " : "       "}${asset.symbol.padEnd(8)} ${String(asset.roundTripLossBps ?? 0).padStart(4)} bps  ${asset.name}\n`);
  for (const row of dropped) process.stdout.write(`  dropped ${row.mint.slice(0, 10)}: ${row.reason}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
