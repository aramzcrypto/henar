/**
 * Provider artwork, taken from the mint's own metadata document.
 *
 * The mint publishes a metadata URI; that document names an image. Following
 * that chain means a product's logo is the one its issuer points at, not a
 * URL Henar guessed. Only https documents on the hosts the providers publish
 * from are fetched, and a failure simply leaves the product without artwork.
 */
import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";

const ALLOWED_HOSTS = new Set(["cdn.tesseralab.co", "prestocks.com", "www.prestocks.com", "cdn.prestocks.com"]);
const schema = z.object({ image: z.string().url().optional(), name: z.string().optional(), symbol: z.string().optional() });
const CACHE_MS = 24 * 60 * 60_000;

function allowed(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port && ALLOWED_HOSTS.has(parsed.hostname) ? parsed.href : null;
  } catch {
    return null;
  }
}

const cache = createReadCache<string | null>(CACHE_MS, 64);

export async function imageFromMetadataUri(uri: string | null | undefined, options: { fetch?: typeof fetch } = {}) {
  const href = uri ? allowed(uri) : null;
  if (!href) return null;
  return cache(href, async () => {
    try {
      const doFetch = options.fetch ?? fetch;
      const response = await doFetch(href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000), next: { revalidate: 86_400 } } as RequestInit);
      if (!response.ok) return null;
      const parsed = schema.safeParse(await response.json());
      return parsed.success && parsed.data.image ? allowed(parsed.data.image) : null;
    } catch {
      return null;
    }
  });
}
