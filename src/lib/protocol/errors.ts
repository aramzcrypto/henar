/** Provider errors may contain RPC URLs or echoed credentials. Never expose those. */
export function safeError(
  error: unknown,
  fallback = "Service unavailable.",
): string {
  if (!(error instanceof Error)) return fallback;
  let message = error.message.replace(/https?:\/\/[^\s"'<>]+/gi, "[provider]");
  for (const name of ["SOLANA_RPC_URL", "JUPITER_API_KEY", "PYTH_API_KEY"]) {
    const secret = process.env[name];
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message.trim().slice(0, 500) || fallback;
}
