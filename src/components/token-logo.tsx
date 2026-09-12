"use client";
import Image from "next/image";
import { useState } from "react";
import type { PaymentToken } from "@/lib/payment-tokens";
export function TokenLogo({
  token,
}: {
  token: Pick<PaymentToken, "symbol" | "logo">;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="token-logo" aria-hidden="true">
      {token.logo && failed !== token.logo ? (
        <Image
          src={token.logo}
          alt=""
          width={32}
          height={32}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setFailed(token.logo!)}
        />
      ) : (
        <span>
          {token.symbol
            .replace(/[^a-z0-9]/gi, "")
            .slice(0, 2)
            .toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}
