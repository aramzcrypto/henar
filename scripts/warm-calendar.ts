/**
 * Populates the parsed SEC research cache for the companies that define
 * calendar coverage. Running this before a deploy means the first visitor gets
 * a full calendar instead of one that fills in over successive requests.
 */
import { equityRegistry } from "../src/lib/equities/registry";
import { secResearchForEquity } from "../src/lib/equities/sec";
import {
  readResearchFileCache,
  writeResearchFileCache,
} from "../src/lib/equities/research-file-cache";

// Defaults cover the calendar set; pass a larger count to pre-warm more
// company pages, e.g. `npm run calendar:warm -- 200`.
const COVERAGE = Number(process.argv[2]) || 80;
const CONCURRENCY = 4;

const companies = [...equityRegistry]
  .sort(
    (a, b) =>
      b.representations.length - a.representations.length ||
      a.ticker.localeCompare(b.ticker),
  )
  .slice(0, COVERAGE);

let done = 0;
let warmed = 0;

async function worker(queue: typeof companies) {
  for (;;) {
    const equity = queue.shift();
    if (!equity) return;
    done += 1;
    if (await readResearchFileCache(equity.ticker)) {
      process.stdout.write(`[${done}/${companies.length}] ${equity.ticker} cached\n`);
      continue;
    }
    try {
      const research = await secResearchForEquity(equity);
      await writeResearchFileCache(equity.ticker, research);
      warmed += 1;
      const count = research.earnings.data?.length ?? 0;
      process.stdout.write(
        `[${done}/${companies.length}] ${equity.ticker} ${research.earnings.status} (${count})\n`,
      );
    } catch (error) {
      process.stdout.write(`[${done}/${companies.length}] ${equity.ticker} failed: ${error}\n`);
    }
    // SEC asks automated clients to stay under 10 requests per second.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function main() {
  const queue = [...companies];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  process.stdout.write(`\nWarmed ${warmed} of ${companies.length} companies.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
