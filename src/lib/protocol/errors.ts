/**
 * Provider errors may carry an RPC URL or echo a credential back at us. None
 * of that may reach a response body.
 *
 * Redaction used to name three variables, one of which — `PYTH_API_KEY` — has
 * never existed in this repo; the real one is `PYTH_PRO_API_KEY`, so Pyth was
 * listed and unprotected. Naming secrets one at a time is the wrong shape: a
 * new integration is protected only if someone remembers to add it here, and
 * Titan's key travels on a `wss://` URL that the http-only pattern skipped.
 *
 * So the rule is now structural. Every environment value long enough to be a
 * credential is redacted, whatever it is called, and every URL scheme is
 * stripped rather than just http and https.
 */

/** Shorter values are flags, ports and public addresses, not credentials. */
const CREDENTIAL_MIN_LENGTH = 16;

/** Public by nature, and useful to keep in a message. */
const NEVER_REDACT = new Set(["NODE_ENV", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION"]);

export function safeError(
  error: unknown,
  fallback = "Service unavailable.",
  env: Record<string, string | undefined> = process.env,
): string {
  if (!(error instanceof Error)) return fallback;
  let message = error.message.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[provider]");
  /* Longest first: a short secret that is a substring of a longer one must not
     leave the tail of the longer one exposed. */
  const secrets = Object.entries(env)
    .filter(([name, value]) => !NEVER_REDACT.has(name) && typeof value === "string" && value.length >= CREDENTIAL_MIN_LENGTH)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) message = message.split(secret).join("[redacted]");
  return message.trim().slice(0, 500) || fallback;
}
