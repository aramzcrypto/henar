import type { EquityRoute } from "./types";
export function routeLabel(route: EquityRoute) {
  const provider = { xstocks: "xStocks", backpack: "Backpack", ondo: "Ondo" }[
    route.provider
  ];
  return route.routeType === "DEX"
    ? `${provider} via ${route.venue}`
    : `${provider} ${{ RFQ: "RFQ", PRIMARY_MINT: "Primary Mint", PRIMARY_REDEEM: "Primary Redeem" }[route.routeType]}`;
}
