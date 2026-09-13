export const ADMIN_SESSION_MS = 5 * 60 * 1000;
export function adminMessage(origin: string, wallet: string, issuedAt: number) {
  return `Henar Admin\n\nRead-only dashboard access.\nWebsite: ${origin}\nWallet: ${wallet}\nIssued at: ${issuedAt}\nExpires at: ${issuedAt + ADMIN_SESSION_MS}\n\nThis signature does not authorize transactions.`;
}
