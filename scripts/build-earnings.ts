/**
 * Builds src/data/earnings.json from SEC EDGAR.
 *
 * The calendar reads filed results out of a parsed-research cache. That cache
 * lives in the OS temp directory, which on a serverless host is per-instance
 * and empty on a cold start — so a deployed calendar showed nothing until it
 * had warmed itself, which it never fully does. Generating the dataset offline
 * and committing it makes the calendar correct everywhere, with no runtime
 * fetch. Same pattern as the sector index.
 */
import { writeFile } from "node:fs/promises";
import { equityRegistry } from "../src/lib/equities/registry";
import { secResearchForEquity } from "../src/lib/equities/sec";
import type { EarningsEvent } from "../src/lib/equities/types";

const COVERAGE = Number(process.argv[2]) || 120;
const CONCURRENCY = 4;
const OUTPUT = "src/data/earnings.json";

export type StoredEarnings = {
  ticker: string;
  name: string;
  logo: string | null;
  sourceUrl: string | null;
  events: EarningsEvent[];
};

const companies = [...equityRegistry]
  .sort(
    (a, b) =>
      b.representations.length - a.representations.length ||
      a.ticker.localeCompare(b.ticker),
  )
  .slice(0, COVERAGE);

async function main() {
  const queue = [...companies];
  const rows: StoredEarnings[] = [];
  let done = 0;

  async function worker() {
    for (;;) {
      const equity = queue.shift();
      if (!equity) return;
      done += 1;
      try {
        const research = await secResearchForEquity(equity);
        const events = research.earnings.data ?? [];
        if (events.length) {
          rows.push({
            ticker: equity.ticker,
            name: equity.name,
            logo: equity.logo,
            sourceUrl: research.earnings.sourceUrl,
            events,
          });
        }
        process.stdout.write(
          `[${done}/${companies.length}] ${equity.ticker} ${events.length} events\n`,
        );
      } catch (error) {
        process.stdout.write(`[${done}/${companies.length}] ${equity.ticker} failed: ${error}\n`);
      }
      // SEC asks automated clients to stay under 10 requests per second.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  await writeFile(OUTPUT, `${JSON.stringify(rows)}\n`, "utf8");
  const total = rows.reduce((sum, row) => sum + row.events.length, 0);
  process.stdout.write(
    `\nWrote ${OUTPUT}: ${rows.length} companies, ${total} filed results.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
