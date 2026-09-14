import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EquityResearch } from "./types";

// SEC company facts are 4-5 MB per company and cannot use the Next fetch cache,
// which drops entries above 2 MB. The in-process unstable_cache wrapper loses
// them on every cold start, and the Supabase tier is optional. This writes the
// small parsed result to the OS temp directory so a cold start reuses it
// instead of re-downloading and re-parsing megabytes of XBRL.
const TTL_MS = 12 * 60 * 60 * 1000;
const VERSION = "v4";

type Envelope = { savedAt: number; research: EquityResearch };

function directory() {
  return join(tmpdir(), "henar-research-cache", VERSION);
}

function pathFor(ticker: string) {
  const safe = createHash("sha256")
    .update(ticker.toUpperCase())
    .digest("hex")
    .slice(0, 32);
  return join(directory(), `${safe}.json`);
}

export async function readResearchFileCache(
  ticker: string,
): Promise<EquityResearch | null> {
  try {
    const raw = await readFile(pathFor(ticker), "utf8");
    const parsed = JSON.parse(raw) as Envelope;
    if (
      typeof parsed?.savedAt !== "number" ||
      Date.now() - parsed.savedAt > TTL_MS ||
      !parsed.research
    )
      return null;
    return parsed.research;
  } catch {
    return null;
  }
}

export async function writeResearchFileCache(
  ticker: string,
  research: EquityResearch,
) {
  try {
    await mkdir(directory(), { recursive: true });
    const envelope: Envelope = { savedAt: Date.now(), research };
    await writeFile(pathFor(ticker), JSON.stringify(envelope), "utf8");
  } catch {
    // A read-only or full filesystem must not break research loading.
  }
}
