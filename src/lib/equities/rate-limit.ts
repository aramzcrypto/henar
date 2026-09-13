const WINDOW_MS = 60_000;
const MAX_QUOTES = 20;
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
  if (current.count >= MAX_QUOTES) return false;
  current.count += 1;
  return true;
}
