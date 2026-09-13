import { PublicKey } from "@solana/web3.js";

export const REFERRAL_SHARE_PERCENT = 10;
export const REFERRAL_PACK_USDC = 10;
export const REFERRAL_STORAGE_KEY = "henar.referral.v1";
export const REFERRAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type ReferralInvitation = { referrer: string; capturedAt: number };

export function referralWallet(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 32 || value.length > 44)
    return null;
  try {
    const key = new PublicKey(value);
    return PublicKey.isOnCurve(key.toBytes()) && key.toBase58() === value
      ? value
      : null;
  } catch {
    return null;
  }
}

// This is an unverified invitation, never a rewards balance or proof of identity.
export function readInvitation(
  raw: string | null,
  now = Date.now(),
): ReferralInvitation | null {
  try {
    const value = JSON.parse(raw || "null");
    if (
      !value ||
      !referralWallet(value.referrer) ||
      !Number.isSafeInteger(value.capturedAt) ||
      value.capturedAt > now ||
      now - value.capturedAt >= REFERRAL_WINDOW_MS
    )
      return null;
    return { referrer: value.referrer, capturedAt: value.capturedAt };
  } catch {
    return null;
  }
}
