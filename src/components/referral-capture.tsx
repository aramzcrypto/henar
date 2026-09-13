"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  referralWallet,
  readInvitation,
  REFERRAL_STORAGE_KEY,
} from "@/lib/referrals";

export function ReferralCapture() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58();
  useEffect(() => {
    const referrer = referralWallet(
      new URLSearchParams(window.location.search).get("ref"),
    );
    try {
      const invitation = readInvitation(
        localStorage.getItem(REFERRAL_STORAGE_KEY),
      );
      if (invitation?.referrer === owner)
        localStorage.removeItem(REFERRAL_STORAGE_KEY);
      if (!referrer || referrer === owner) return;
      if (!invitation || invitation.referrer === owner) {
        localStorage.setItem(
          REFERRAL_STORAGE_KEY,
          JSON.stringify({ referrer, capturedAt: Date.now() }),
        );
      }
    } catch {
      // Browsers that disallow storage can still use the app.
    }
  }, [pathname, owner]);
  return null;
}
