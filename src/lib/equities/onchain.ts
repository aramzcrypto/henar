import { assertMainnet, connection, verifiedMint } from "@/lib/solana";
import type { Equity, Representation } from "./types";

export async function verifiedRepresentations(
  equity: Equity,
): Promise<Representation[]> {
  const c = connection();
  await assertMainnet(c);
  const results = await Promise.allSettled(
    equity.representations.map(async (representation) => ({
      representation,
      mint: await verifiedMint(c, representation.mint),
    })),
  );
  return results.map((result, index) =>
    result.status === "fulfilled"
      ? {
          ...result.value.representation,
          decimals: result.value.mint.decimals,
          tokenProgram: result.value.mint.program,
        }
      : {
          ...equity.representations[index],
          providerStatus: "unavailable" as const,
          tradingStatus: "unavailable" as const,
        },
  );
}
