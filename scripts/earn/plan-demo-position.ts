/**
 * Plan a team-funded demo position, and stop.
 *
 * This script reads live state, validates the configuration, checks every
 * precondition and prints exactly what funding the strategy would do. It
 * builds no transaction, signs nothing and spends nothing.
 *
 *   npm run earn:plan -- earn-stocks
 *   npm run earn:plan -- smart-accumulate
 *   npm run earn:plan -- range-yield
 *
 * Funding a mainnet position is a separate, manual, explicitly authorized
 * step. Nothing here performs it, and nothing here should be changed to.
 */
import { Connection } from "@solana/web3.js";
import { DEMO_EARN_STOCKS, DEMO_RANGE_YIELD, DEMO_SMART_ACCUMULATE, definitionBySlug } from "../../src/lib/strategies/definitions";
import { configProblems, validateEarnStocksConfig, validateRangeYieldConfig, validateSmartAccumulateConfig } from "../../src/lib/strategies/config";
import { admitMarket, marketByAddress } from "../../src/lib/strategies/markets";
import { readPool } from "../../src/lib/strategies/adapters/meteora";
import { reserveSnapshot } from "../../src/lib/strategies/adapters/kamino";
import { buildLadder, ladderToBins, priceRange } from "../../src/lib/strategies/ladder";
import { strategyDeployment } from "../../src/lib/strategies/deployment";

const usd = (raw: string, decimals = 6) => `$${(Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!slug) throw new Error("Usage: npm run earn:plan -- <earn-stocks|smart-accumulate|range-yield>");
  const definition = definitionBySlug(slug);
  if (!definition) throw new Error(`Unknown strategy ${slug}`);

  const out = (line: string) => process.stdout.write(`${line}\n`);
  out(`\n${definition.name} ${definition.version} — funding plan (nothing is executed)\n`);

  const deployment = strategyDeployment(slug);
  out(`Existing deployment: ${deployment.configured ? `${deployment.deployment.positions.length} position(s), owner ${deployment.deployment.owner}` : deployment.reason}`);

  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required to read live state.");
  const connection = new Connection(rpc, "confirmed");

  if (slug === "earn-stocks") {
    const parsed = validateEarnStocksConfig(DEMO_EARN_STOCKS);
    out(`Configuration: ${parsed.success ? "valid" : configProblems(parsed).join("; ")}`);
    const reserve = await reserveSnapshot(DEMO_EARN_STOCKS.market, DEMO_EARN_STOCKS.reserve);
    out(`Kamino reserve ${DEMO_EARN_STOCKS.reserve}`);
    out(`  market            ${DEMO_EARN_STOCKS.market}`);
    out(`  supply rate       ${reserve?.supplyApy === null || reserve === null ? "unavailable" : `${reserve.supplyApy.toFixed(2)}%`}`);
    out(`  reserve size      ${reserve?.totalSupplyUsd ? `$${Math.round(reserve.totalSupplyUsd).toLocaleString()}` : "unavailable"}`);
    out(`\nWhat funding would do:`);
    out(`  1. Supply USDC to the reserve above from the Henar demo wallet.`);
    out(`  2. Record the collateral amount and exchange rate as the yield basis.`);
    out(`  3. Set HENAR_STRATEGY_EARN_STOCKS to the owner, position and basis.`);
    out(`  Conversions begin only once realized yield reaches ${usd(DEMO_EARN_STOCKS.minimumHarvestAmount)}.`);
    out(`\nMAINNET EFFECT: a USDC transfer into a Kamino lending reserve. Amount is chosen by the operator at funding time; nothing here fixes it.`);
  }

  if (slug === "smart-accumulate" || slug === "range-yield") {
    const config = slug === "smart-accumulate" ? DEMO_SMART_ACCUMULATE : DEMO_RANGE_YIELD;
    const parsed = slug === "smart-accumulate" ? validateSmartAccumulateConfig(config) : validateRangeYieldConfig(config);
    out(`Configuration: ${parsed.success ? "valid" : configProblems(parsed).join("; ")}`);
    const candidate = marketByAddress(config.pool);
    if (!candidate) throw new Error(`Pool ${config.pool} is not in the strategy market registry.`);
    const admission = admitMarket(candidate, { requireLimitOrders: slug === "smart-accumulate" });
    out(`Market admission: ${admission.admitted ? "admitted" : "REFUSED"}`);
    for (const line of admission.admitted ? admission.reasons : admission.failures) out(`  - ${line}`);
    if (!admission.admitted) {
      out(`\nRefusing to plan a position in a market that does not pass the registry.`);
      process.exitCode = 1;
      return;
    }
    const pool = await readPool(connection, config.pool);
    out(`\nPool ${config.pool}`);
    out(`  pair              ${candidate.assetSymbol}/${candidate.quoteSymbol}`);
    out(`  bin step          ${pool.binStep ?? "unavailable"}`);
    out(`  active price      ${pool.activePrice ?? "unavailable"}`);
    out(`  limit orders      ${pool.supportsLimitOrders === null ? "unknown" : pool.supportsLimitOrders ? "supported" : "NOT supported"}`);
    out(`  read at slot      ${pool.slot ?? "unavailable"}`);

    if (slug === "smart-accumulate") {
      if (!pool.activePrice) throw new Error("No price available; cannot plan a ladder.");
      if (pool.supportsLimitOrders === false) throw new Error("This pool cannot accept limit orders; the strategy would not be one-way.");
      const smart = config as typeof DEMO_SMART_ACCUMULATE;
      const levels = buildLadder({ reference: pool.activePrice, rangeStartBps: smart.rangeStartBps, rangeEndBps: smart.rangeEndBps, levels: smart.levels, distribution: smart.distribution, capital: BigInt(smart.capital) });
      const { bins } = ladderToBins(levels, pool.binStep!, pool.baseDecimals!, pool.quoteDecimals!);
      out(`\nLadder from the current price, ${usd(smart.capital)} total:`);
      for (const level of levels) out(`  ${level.price.padStart(12)}  ${usd(level.allocated).padStart(9)}`);
      out(`\nAs a limit order: ${bins.length} bin(s), ${bins.map((b) => `${b.binId}:${usd(b.amount)}`).join(", ")}`);
      out(`  Meteora allows at most 50 bins per order; this uses ${bins.length}.`);
      out(`\nMAINNET EFFECT: one place_limit_order transaction depositing ${usd(smart.capital)} of USDC across those bins, from the Henar demo wallet.`);
      out(`  Fills are one-way and permanent. Only the owner can later settle or cancel them.`);
    } else {
      if (!pool.activePrice) throw new Error("No price available; cannot plan a range.");
      const yieldConfig = config as typeof DEMO_RANGE_YIELD;
      const range = priceRange({ reference: pool.activePrice, lowerBps: yieldConfig.rangeLowerBps, upperBps: yieldConfig.rangeUpperBps });
      out(`\nRange around the current price: ${range.lower} to ${range.upper}`);
      out(`  distribution      ${yieldConfig.distributionStrategy}`);
      out(`  capital           ${yieldConfig.baseCapital === "0" && yieldConfig.quoteCapital === "0" ? "not yet sized — choose at funding time" : `${yieldConfig.baseCapital} base / ${usd(yieldConfig.quoteCapital)}`}`);
      out(`\nMAINNET EFFECT: one position-open transaction depositing both ${candidate.assetSymbol} and USDC into the pool, from the Henar demo wallet.`);
      out(`  The position becomes stock-heavy as price falls and cash-heavy as it rises.`);
    }
  }

  out(`\n--- NOT EXECUTED ---`);
  out(`This script plans only. Funding requires a separate, manually authorized step`);
  out(`with HENAR_STRATEGY_MAINNET_ACTIONS=1 and an operator signature.\n`);
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
