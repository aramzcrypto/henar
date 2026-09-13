export const QUOTE_SESSION_MS = 5 * 60 * 1000;
export function quoteAccessMessage(
  origin: string,
  wallet: string,
  issuedAt: number,
) {
  return `Henar quote access\n\nWebsite: ${origin}\nWallet: ${wallet}\nIssued at: ${issuedAt}\nExpires at: ${issuedAt + QUOTE_SESSION_MS}\n\nAllows requesting trade quotes for this wallet. Does not authorize transactions or move funds.`;
}
