"use client";

import Image from "next/image";
import { useState } from "react";

export function EquityLogo({
  logo,
  ticker,
  size = 38,
  priority = false,
}: {
  logo: string | null;
  ticker: string;
  size?: number;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // Catalog logos are same-origin bitmaps and benefit from Next's resizing: the
  // raw files run up to ~100 KB each for a 38px slot. SVGs are passed through
  // untouched because the optimizer rejects them by default.
  const unoptimized = !logo?.startsWith("/") || logo.endsWith(".svg");
  return (
    <span className="equity-logo" style={{ width: size, height: size }}>
      {logo && !failed ? (
        <Image
          src={logo}
          width={size}
          height={size}
          alt=""
          unoptimized={unoptimized}
          priority={priority}
          loading={priority ? undefined : "lazy"}
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{ticker.slice(0, 2)}</span>
      )}
    </span>
  );
}
