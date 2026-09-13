import type { Equity } from "./types";
import { onchainComparison } from "./jupiter";
import { providerRoutes } from "./company-routes";
import { bestNetRoute, capabilitiesFor, dexRoute } from "./routes";
import { traditionalMarketStatus } from "./market-hours";
import { createReadCache } from "@/lib/read-cache";
import { discoverEarn } from "./earn";
async function loadComparison(equity: Equity) {
  const [dex, providers, earn, traditionalMarket] = await Promise.all([
    onchainComparison(equity),
    providerRoutes(equity),
    discoverEarn(equity),
    traditionalMarketStatus(),
  ]);
  const routes = [
    ...dex.executionQuotes.map((q) => dexRoute(q, "buy")),
    ...providers.routes,
  ];
  const bestRoute = bestNetRoute(routes, "buy", "10000");
  return {
    ...dex,
    routes,
    bestRoute,
    earn,
    traditionalMarket,
    backpackStatus: providers.backpackStatus,
    capabilities: Object.fromEntries(
      equity.representations.map((r) => {
        const capabilities = capabilitiesFor(
          r,
          routes,
          earn.opportunities,
          traditionalMarket.status === "closed",
        );
        const live = dex.representations.find(
          (row) => row.representationId === r.id,
        );
        if (
          live?.marketStatus === "active" &&
          live.quoteAsOf &&
          Date.now() - Date.parse(live.quoteAsOf) < 30_000
        ) {
          capabilities.tradeCapabilities.dexSwap = true;
          capabilities.marketCapabilities.secondaryTrading = true;
          capabilities.marketCapabilities.afterHoursTrading =
            traditionalMarket.status === "closed";
        }
        return [r.id, capabilities];
      }),
    ),
  };
}
export type CompanyComparison = Awaited<ReturnType<typeof loadComparison>>;
const cached = createReadCache<CompanyComparison>(10_000);
export function companyComparison(equity: Equity) {
  return cached(equity.id, () => loadComparison(equity));
}
