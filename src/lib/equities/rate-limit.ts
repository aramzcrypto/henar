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

/**
 * The RPC relay's own ceiling, which is not the quote ceiling.
 *
 * A quote is one deliberate action. The relay is wallet plumbing: a single
 * trade spends a blockhash read, a simulation, a submission and several
 * status polls, and a page spends balance and account reads before any of
 * that. Holding it to sixty a minute would refuse ordinary use behind any
 * shared address — an office, a campus, a mobile carrier's NAT — which is a
 * broken product rather than a protected one.
 *
 * Four times the quote budget is far above what the interface can generate
 * and far below what an abuser wants. `HENAR_PUBLIC_RELAY_BUDGET` overrides
 * it without a code change.
 */
const DEFAULT_MAX_RELAY = DEFAULT_MAX_QUOTES * 4;

function maxRelay() {
  const configured = Number(process.env.HENAR_PUBLIC_RELAY_BUDGET);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_RELAY;
}

const relayBudgets = new Map<string, { count: number; expiresAt: number }>();

function consume(
  store: Map<string, { count: number; expiresAt: number }>,
  ceiling: number,
  request: Request,
  now: number,
) {
  const key = clientKey(request);
  const current = store.get(key);
  if (!current || current.expiresAt <= now) {
    store.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    if (store.size > 5_000)
      for (const [id, budget] of store) if (budget.expiresAt <= now) store.delete(id);
    return true;
  }
  if (current.count >= ceiling) return false;
  current.count += 1;
  return true;
}

/** The RPC relay, on its own counter so wallet traffic never spends a quote. */
export function consumeRelayBudget(request: Request, now = Date.now()) {
  return consume(relayBudgets, maxRelay(), request, now);
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
