import Image from "next/image";
import type { ExecutionSource } from "@/lib/execution/types";

export const executionSourceBrand: Record<
  ExecutionSource,
  { label: string; logo: string | null }
> = {
  jupiter: { label: "Jupiter", logo: "/dex/jupiter.png" },
  raydium: { label: "Raydium", logo: "/dex/raydium.svg" },
  orca: { label: "Orca", logo: "/dex/orca.png" },
  meteora: { label: "Meteora", logo: "/dex/meteora.svg" },
  phoenix: { label: "Phoenix", logo: "/dex/phoenix.svg" },
  openbook: { label: "OpenBook", logo: "/dex/openbook.png" },
  lifinity: { label: "Lifinity", logo: "/dex/lifinity.png" },
  openocean: { label: "OpenOcean", logo: "/dex/openocean.png" },
  titan: { label: "Titan", logo: null },
};

export function getExecutionSourceBrand(source: string) {
  if (source in executionSourceBrand) {
    return executionSourceBrand[source as ExecutionSource];
  }

  return {
    label: source ? `${source[0].toUpperCase()}${source.slice(1)}` : "Route",
    logo: null,
  };
}

export function ExecutionSourceLogo({ source }: { source: string }) {
  const brand = getExecutionSourceBrand(source);
  const knownSource = source in executionSourceBrand ? source : "unknown";

  return (
    <span className={`quote-source quote-source-${knownSource}`} aria-hidden="true">
      {brand.logo ? (
        <Image src={brand.logo} alt="" width={22} height={22} unoptimized />
      ) : (
        brand.label.slice(0, 1)
      )}
    </span>
  );
}
