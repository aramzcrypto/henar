/**
 * What each issuer has actually put on chain, as opposed to registered.
 *
 * The catalog says Backpack publishes 1,069 Solana mints, more than the other
 * two issuers combined. Read against mainnet, almost none of them hold any
 * tokens: a Backpack token exists only once someone withdraws an entitlement,
 * and for most securities nobody has. Its NVIDIA mint has a supply of zero.
 *
 * Without this, a reader compares 1,069 against 711 and draws exactly the
 * wrong conclusion, and nothing else on the page corrects them — AMM
 * liquidity does not, because it cannot distinguish a token that nobody
 * trades from a token that does not exist. Ondo is the mirror image: 94% of
 * its mints hold supply and almost none of it trades, so liquidity alone
 * makes a real issuer look like a rounding error.
 */
import { unstable_cache } from "next/cache";
import { createReadCache } from "@/lib/read-cache";
import { readMintSupplies } from "@/lib/equities/mint-supply";
import { provenance } from "@/lib/provenance";
import { issuerRepresentations } from "./profiles";
import { ISSUER_IDS, type IssuerId, type IssuerOnchainPresence } from "./types";

/* Supply moves when someone mints or redeems, which is far slower than a
   price. A long window keeps 23 account reads off the request path. */
const WINDOW_SECONDS = 30 * 60;

type SupplyCounts = Record<IssuerId, { registered: number; live: number; read: number }>;

async function measure(): Promise<SupplyCounts> {
  const mints = ISSUER_IDS.flatMap((id) =>
    issuerRepresentations(id).map((representation) => representation.mint),
  );
  const supplies = await readMintSupplies(mints);
  return Object.fromEntries(
    ISSUER_IDS.map((id) => {
      const own = issuerRepresentations(id);
      const rows = own.map((representation) => supplies.get(representation.mint));
      return [
        id,
        {
          registered: own.length,
          /* Only mints we actually read and found holding something. An
             unreadable account is never counted as empty. */
          live: rows.filter((row) => row?.live === true).length,
          read: rows.filter((row) => row?.live !== null && row?.live !== undefined).length,
        },
      ];
    }),
  ) as SupplyCounts;
}

const shared = unstable_cache(measure, ["henar-issuer-onchain-presence-v1"], {
  revalidate: WINDOW_SECONDS,
});

const hot = createReadCache<SupplyCounts>(WINDOW_SECONDS * 1000, 2, {
  staleWhileRevalidate: true,
});

export async function issuerOnchainPresence(
  options: { fresh?: boolean } = {},
): Promise<Record<IssuerId, IssuerOnchainPresence>> {
  const observedAt = new Date().toISOString();
  let counts: SupplyCounts | null = null;
  try {
    counts = await hot("presence", () => shared(), options.fresh);
  } catch {
    counts = null;
  }
  return Object.fromEntries(
    ISSUER_IDS.map((id) => {
      const row = counts?.[id];
      const registered = issuerRepresentations(id).length;
      return [
        id,
        {
          status: row && row.read > 0 ? "available" : "unavailable",
          registered,
          live: row && row.read > 0 ? row.live : null,
          read: row?.read ?? 0,
          reason:
            row && row.read > 0
              ? null
              : "Mint supply could not be read from mainnet, so registered mints are not claimed as live.",
          provenance: provenance({
            source: "Solana mainnet",
            provider: "solana",
            sourceType: "onchain",
            observedAt,
            freshness: "fresh",
          }),
        } satisfies IssuerOnchainPresence,
      ];
    }),
  ) as Record<IssuerId, IssuerOnchainPresence>;
}
