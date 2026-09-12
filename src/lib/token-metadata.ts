import { z } from "zod";
const item = z.object({
  id: z.string(),
  symbol: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  icon: z.string().nullish(),
});
const imageHosts = new Set([
  "raw.githubusercontent.com",
  "static.jup.ag",
  "img.jup.ag",
  "cdn.jup.ag",
  "arweave.net",
  "ipfs.io",
  "gateway.pinata.cloud",
  "cdn.solscan.io",
  "coin-images.coingecko.com",
  "assets.coingecko.com",
]);
function trustedIcon(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      imageHosts.has(url.hostname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
/** Cosmetic metadata only. Transaction decimals/eligibility always come from chain. */
export async function tokenMetadata(mints: string[]) {
  const key = process.env.JUPITER_API_KEY;
  if (!key || !mints.length) return [];
  const query = [...new Set(mints)].slice(0, 100);
  const res = await fetch(
    `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(query.join(","))}`,
    {
      headers: { "x-api-key": key },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) throw new Error("Token metadata unavailable");
  const raw = z.array(z.unknown()).parse(await res.json());
  return raw.flatMap((value) => {
    const parsed = item.safeParse(value);
    if (!parsed.success || !query.includes(parsed.data.id)) return [];
    const t = parsed.data;
    return [
      { mint: t.id, symbol: t.symbol, name: t.name, logo: trustedIcon(t.icon) },
    ];
  });
}
