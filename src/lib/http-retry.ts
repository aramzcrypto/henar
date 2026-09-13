const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0)
    return Math.min(retryAfter * 1_000, 750);
  return attempt === 0 ? 150 : 400;
}

export async function fetchWithTransientRetry(
  request: () => Promise<Response>,
  options: {
    attempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const attempts = options.attempts ?? 3;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let response: Response | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    response = await request();
    if (
      !TRANSIENT_HTTP_STATUSES.has(response.status) ||
      attempt === attempts - 1
    )
      return response;
    await sleep(retryDelay(response, attempt));
  }

  return response!;
}
