/**
 * Builds src/data/sectors.json from SEC EDGAR.
 *
 * Sector classification comes from the SIC code each company files with the
 * SEC, so it is verified rather than inferred. Running this offline keeps
 * /markets free of any per-request classification work.
 */
import { writeFile } from "node:fs/promises";
import { equityRegistry } from "../src/lib/equities/registry";
import { sectorForSic, type Sector } from "../src/lib/equities/sectors";

const USER_AGENT = "Henar research (aram.mebashar@gmail.com)";
const CONCURRENCY = 6;
const OUTPUT = "src/data/sectors.json";

type Row = { sector: Sector; sic: string; industry: string };

async function secJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`SEC ${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

function normalizedCik(value: string | number) {
  return String(value).replace(/^0+/, "").padStart(10, "0");
}

async function main() {
  process.stdout.write("Loading SEC ticker index…\n");
  const tickerRows = await secJson<
    Record<string, { cik_str?: number; ticker?: string }>
  >("https://www.sec.gov/files/company_tickers.json");
  const cikByTicker = new Map<string, string>();
  for (const row of Object.values(tickerRows)) {
    if (row.ticker && row.cik_str !== undefined)
      cikByTicker.set(row.ticker.toUpperCase(), normalizedCik(row.cik_str));
  }
  process.stdout.write(`SEC index holds ${cikByTicker.size} tickers.\n`);

  const queue = equityRegistry
    .map((equity) => ({ ticker: equity.ticker, cik: cikByTicker.get(equity.ticker) }))
    .filter((entry): entry is { ticker: string; cik: string } => Boolean(entry.cik));
  process.stdout.write(
    `Matched ${queue.length} of ${equityRegistry.length} catalog companies.\n`,
  );

  const result: Record<string, Row> = {};
  let processed = 0;
  let classified = 0;

  async function worker() {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      processed += 1;
      try {
        const submission = await secJson<{
          sic?: string;
          sicDescription?: string;
        }>(`https://data.sec.gov/submissions/CIK${entry.cik}.json`);
        const sector = sectorForSic(submission.sic ?? null);
        if (sector) {
          classified += 1;
          result[entry.ticker] = {
            sector,
            sic: String(submission.sic),
            industry: submission.sicDescription ?? "",
          };
        }
      } catch {
        // A company without a retrievable submission is simply unclassified.
      }
      if (processed % 100 === 0)
        process.stdout.write(`  ${processed} processed, ${classified} classified\n`);
      // SEC asks automated clients to stay under 10 requests per second.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const ordered = Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(OUTPUT, `${JSON.stringify(ordered, null, 0)}\n`, "utf8");

  const counts = new Map<string, number>();
  for (const row of Object.values(ordered))
    counts.set(row.sector, (counts.get(row.sector) ?? 0) + 1);
  process.stdout.write(`\nWrote ${OUTPUT} with ${Object.keys(ordered).length} companies.\n`);
  for (const [sector, count] of [...counts].sort((a, b) => b[1] - a[1]))
    process.stdout.write(`  ${sector}: ${count}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
