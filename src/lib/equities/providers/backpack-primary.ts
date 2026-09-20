import { z } from "zod";
import { createReadCache } from "@/lib/read-cache";
import type { EquityRoute, Representation } from "../types";

const API = "https://api.backpack.exchange";
export const BACKPACK_DOCS = "https://docs.backpack.exchange/";
const assetsSchema = z.array(
  z.object({
    symbol: z.string(),
    tokens: z.array(
      z.object({
        blockchain: z.string(),
        contractAddress: z.string().nullable(),
        depositEnabled: z.boolean(),
        withdrawEnabled: z.boolean(),
        minimumDeposit: z.string().nullable().optional(),
        minimumWithdrawal: z.string().nullable().optional(),
        withdrawalFee: z.string().nullable().optional(),
      }),
    ),
  }),
);
const securitiesSchema = z.array(
  z.object({
    asset: z.string(),
    sessions: z.array(z.object({ name: z.string() })),
  }),
);
const marketsSchema = z.array(
  z.object({
    baseSymbol: z.string(),
    quoteSymbol: z.string(),
    marketType: z.string(),
    symbol: z.string(),
    orderBookState: z.string(),
  }),
);
export type BackpackSnapshot = {
  assets: z.infer<typeof assetsSchema>;
  securities: z.infer<typeof securitiesSchema>;
  markets: z.infer<typeof marketsSchema>;
  checkedAt: string;
};
const cached = createReadCache<BackpackSnapshot>(30_000, 1);
export async function backpackSnapshot(): Promise<BackpackSnapshot> {
  return cached("public", async () => {
    const read = async (path: string) => {
      /* Issuer metadata, not a quote. Shared across instances so a cold one
         does not re-read the whole asset and securities catalog. */
      const response = await fetch(`${API}/api/v1/${path}`, {
        next: { revalidate: 30 },
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok)
        throw new Error("Backpack public metadata unavailable.");
      return response.json();
    };
    const [assets, securities, markets] = await Promise.all([
      read("assets"),
      read("securities"),
      read("markets"),
    ]);
    return {
      assets: assetsSchema.parse(assets),
      securities: securitiesSchema.parse(securities),
      markets: marketsSchema.parse(markets),
      checkedAt: new Date().toISOString(),
    };
  });
}

/** Conversion is a securities withdrawal/deposit, not a vault mint/redeem API.
 * Never infer tokenization from /securities alone or from a matching ticker.
 */
export function backpackRoutes(
  representation: Representation,
  snapshot: BackpackSnapshot,
): EquityRoute[] {
  if (
    representation.provider !== "backpack" ||
    representation.providerStatus !== "verified"
  )
    return [];
  const asset = snapshot.assets.find(
    (asset) =>
      snapshot.securities.some((security) => security.asset === asset.symbol) &&
      asset.tokens.some(
        (token) =>
          token.blockchain === "Solana" &&
          token.contractAddress === representation.mint,
      ),
  );
  const token = asset?.tokens.find(
    (token) =>
      token.blockchain === "Solana" &&
      token.contractAddress === representation.mint,
  );
  if (!asset || !token) return [];
  const common = {
    representationId: representation.id,
    provider: representation.provider,
    tokenSymbol: representation.tokenSymbol,
    mint: representation.mint,
    venue: "Backpack Securities",
    eligibilityRequirements: [
      "Backpack account connection",
      "Approved KYC and securities eligibility",
      "Account and jurisdiction permissions",
    ],
    destinationUrl: "https://backpack.exchange",
    sourceUrl: BACKPACK_DOCS,
    checkedAt: snapshot.checkedAt,
    quote: null,
  };
  const routes: EquityRoute[] = [
    {
      ...common,
      id: `${representation.id}:PRIMARY_MINT`,
      routeType: "PRIMARY_MINT",
      side: "buy",
      availability: token.withdrawEnabled
        ? "requires_connection"
        : "unavailable",
      settlementNotes: `Eligible ${asset.symbol} security entitlement → Solana token through withdrawal. Funding and entitlement acquisition must be quoted separately. Minimum withdrawal: ${token.minimumWithdrawal ?? "unavailable"}; withdrawal fee: ${token.withdrawalFee ?? "unavailable"} ${asset.symbol}. Direct execution in Henar requires a Backpack connection, which is not yet available.`,
    },
    {
      ...common,
      id: `${representation.id}:PRIMARY_REDEEM`,
      routeType: "PRIMARY_REDEEM",
      side: "sell",
      availability: token.depositEnabled
        ? "requires_connection"
        : "unavailable",
      settlementNotes: `Solana token → corresponding security entitlement through deposit to the authenticated account address. Minimum deposit: ${token.minimumDeposit ?? "unavailable"}. This is not a guaranteed USDC cash-out. Direct execution in Henar requires a Backpack connection, which is not yet available.`,
    },
  ];
  // Official Stock Trading docs specify this symbol; /markets excludes stock RFQs.
  const security = snapshot.securities.find((s) => s.asset === asset.symbol);
  if (security?.sessions.length) {
    for (const side of ["buy", "sell"] as const)
      routes.push({
        ...common,
        id: `${representation.id}:RFQ:${side}`,
        routeType: "RFQ",
        side,
        availability: "requires_connection",
        settlementNotes: `${asset.symbol}_USDC_RFQ: only during eligible security sessions. Requires a security quantity; quoteQuantity is unsupported. Accepted quotes are binding and use deferred entitlement settlement. Solana withdrawal is separate. No all-in token quote is available.`,
      });
  }
  return routes;
}

/** Read-only API operation descriptors for a future authenticated account connector.
 * No credentials, signing, funding, deposits or withdrawals are performed by discovery.
 */
export const backpackPrimaryOperations = {
  mint: {
    method: "POST",
    path: "/wapi/v1/capital/withdrawals",
    instruction: "withdraw",
  },
  redeemAddress: {
    method: "GET",
    path: "/wapi/v1/capital/deposit/address",
    instruction: "depositAddressQuery",
    query: { blockchain: "Solana" },
  },
} as const;
