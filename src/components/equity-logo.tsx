"use client";

import Image from "next/image";
import { useState } from "react";

export function EquityLogo({
  logo,
  ticker,
  size = 38,
}: {
  logo: string | null;
  ticker: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="equity-logo" style={{ width: size, height: size }}>
      {logo && !failed ? (
        <Image
          src={logo}
          width={size}
          height={size}
          alt=""
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{ticker.slice(0, 2)}</span>
      )}
    </span>
  );
}
