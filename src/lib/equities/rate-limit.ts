const WINDOW_MS = 60_000;

/**
 * Quotes one client may ask for per minute.
 *
 * Twenty was below ordinary product use, never mind comparison: a trade
 * ticket refreshes roughly four times a minute, so three open tickets plus
 * the markets page exhausted the budget and the user watched live prices turn
 * into 429s. A router that cannot be asked cannot be compared, and a
 * benchmark against Jupiter ran out after about thirty quotes.
 *
 * Sixty keeps a bound on abuse while leaving room for the product and for
 * anyone measuring it. `HENAR_PUBLIC_QUOTE_BUDGET` overrides it without a
 * code change. Note this counter is per serverless instance and in memory,
 * so a determined caller spread across instances still gets more than sixty;
 * the platform's own limits are the ceiling. It is a real bound per instance
 * though, which it was not while the key could be set by the caller.
 */
const DEFAULT_MAX_QUOTES = 60;

function maxQuotes() {
  const configured = Number(process.env.HENAR_PUBLIC_QUOTE_BUDGET);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_QUOTES;
}
const budgets = new Map<string, { count: number; expiresAt: number }>();

/**
 * Which client a request is counted against.
 *
 * The leftmost `x-forwarded-for` entry is whatever the client sent. A proxy
 * appends the address it actually saw, so the first hop is an assertion by
 * the caller and the last is an observation by the platform. Keying on the
 * first meant `X-Forwarded-For: <anything>` bought a fresh budget on every
 * request, which is not a weak bound but no bound at all.
 *
 * Vercel sets `x-vercel-forwarded-for` itself and a client cannot forge it,
 * so it is preferred. Failing that, take the last `x-forwarded-for` entry,
 * which is the hop nearest us rather than the one furthest away.
 */
export function clientKey(request: Request) {
  const platform = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (platform) return platform;
  const chain = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain?.length) return chain[chain.length - 1];
  return request.headers.get("x-real-ip")?.trim() || "local";
}

export function consumePublicQuoteBudget(request: Request, now = Date.now()) {
  const key = clientKey(request);
  const current = budgets.get(key);
  if (!current || current.expiresAt <= now) {
    budgets.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    if (budgets.size > 5_000)
      for (const [id, budget] of budgets)
        if (budget.expiresAt <= now) budgets.delete(id);
    return true;
  }
  if (current.count >= maxQuotes()) return false;
  current.count += 1;
  return true;
}
