import { Buffer } from "buffer";
import { quoteAccessMessage, QUOTE_SESSION_MS } from "./wallet-access";
let access:
  | { wallet: string; origin: string; until: number; token: string }
  | undefined;
export async function quoteAuthorization(
  wallet: string,
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>,
) {
  const origin = window.location.origin;
  if (
    access?.wallet === wallet &&
    access.origin === origin &&
    access.until > Date.now() + 10_000
  )
    return access.token;
  if (!signMessage)
    throw new Error(
      "This wallet cannot sign quote access messages. Choose a compatible wallet.",
    );
  const response = await fetch(
    `/api/wallet-access?wallet=${encodeURIComponent(wallet)}`,
    { cache: "no-store" },
  );
  const challenge = await response.json();
  if (!response.ok) throw new Error("Could not prepare wallet access.");
  // Never blindly sign arbitrary text returned by an API.
  if (
    challenge.wallet !== wallet ||
    !Number.isSafeInteger(challenge.issuedAt) ||
    Math.abs(challenge.issuedAt - Date.now()) > 60_000 ||
    challenge.expiresAt !== challenge.issuedAt + QUOTE_SESSION_MS ||
    challenge.message !== quoteAccessMessage(origin, wallet, challenge.issuedAt)
  )
    throw new Error("Invalid quote access request.");
  const signature = await signMessage(
    new TextEncoder().encode(challenge.message),
  );
  const token = `Bearer ${Buffer.from(JSON.stringify({ wallet, issuedAt: challenge.issuedAt, signature: Buffer.from(signature).toString("base64") })).toString("base64")}`;
  access = { wallet, origin, until: challenge.expiresAt, token };
  return token;
}
