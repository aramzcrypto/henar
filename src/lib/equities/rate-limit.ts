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
 * so it is a courtesy bound, not a security control; the platform's own
 * limits are what stop a determined caller.
 */
const DEFAULT_MAX_QUOTES = 60;

function maxQuotes() {
  const configured = Number(process.env.HENAR_PUBLIC_QUOTE_BUDGET);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_QUOTES;
}
const budgets = new Map<string, { count: number; expiresAt: number }>();

export function consumePublicQuoteBudget(request: Request, now = Date.now()) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    .trim();
  const key = forwarded || request.headers.get("x-real-ip") || "local";
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
