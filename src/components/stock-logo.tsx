"use client";
import Image from "next/image";
import { useState } from "react";
import type { Stock } from "@/lib/registry";
export function StockLogo({
  stock,
  small = false,
}: {
  stock: Stock;
  small?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={`asset-logo ${small ? "small" : ""} ${stock.logo && failed !== stock.logo ? "has-logo" : ""}`}
    >
      {stock.logo && failed !== stock.logo ? (
        <Image
          src={stock.logo}
          width={small ? 26 : 42}
          height={small ? 26 : 42}
          alt=""
          unoptimized
          onError={() => setFailed(stock.logo)}
        />
      ) : (
        <span className="logo-fallback">{stock.underlying.slice(0, 2)}</span>
      )}
    </span>
  );
}
