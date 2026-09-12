import { PYTH_HERMES_URL, PYTH_PROGRAMS } from "../../src/lib/protocol/pyth";
import { z } from "zod";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { TransactionBuilder } from "@pythnetwork/solana-utils";
import { Wallet } from "@coral-xyz/anchor";
import {
  type Connection,
  type Keypair,
  type Signer,
  type VersionedTransaction,
} from "@solana/web3.js";
const price = z.object({
  price: z.string().regex(/^-?\d+$/),
  conf: z.string().regex(/^\d+$/),
  expo: z.number().int(),
  publish_time: z.number().int(),
});
const response = z.object({
  binary: z.object({
    encoding: z.literal("base64"),
    data: z.array(z.string().min(1)).min(1),
  }),
  parsed: z.array(z.object({ id: z.string(), price })),
});
export async function fetchPrices(feeds: string[]) {
  const key = process.env.PYTH_API_KEY;
  if (!key)
    throw new Error(
      "PYTH_API_KEY is required for authenticated price updates.",
    );
  const params = new URLSearchParams({ encoding: "base64", parsed: "true" });
  for (const feed of feeds) params.append("ids[]", feed);
  const result = await fetch(
    `${PYTH_HERMES_URL}/v2/updates/price/latest?${params}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (result.status === 403)
    throw new Error("Pyth access denied (403): this key or plan is not entitled to one or more requested feeds. Enable the required equity feeds with Pyth.");
  if (result.status === 401)
    throw new Error("Pyth authentication failed (401). Check the server-side API key.");
  if (!result.ok)
    throw new Error(`Oracle service unavailable (${result.status}).`);
  const value = response.parse(await result.json());
  const prices = new Map(
    value.parsed.map((p) => [p.id.replace(/^0x/, ""), p.price]),
  );
  for (const feed of feeds)
    if (!prices.has(feed)) throw new Error("Oracle feed missing.");
  return { binary: value.binary.data, prices };
}
export async function postPrices(
  connection: Connection,
  keypair: Keypair,
  binary: string[],
  send: (tx: VersionedTransaction, signers: Signer[]) => Promise<void>,
) {
  const receiver = new PythSolanaReceiver({
    connection,
    ...PYTH_PROGRAMS,
    wallet: new Wallet(keypair),
  });
  // This method verifies a full Wormhole VAA; the atomic/partial-signature shortcut is deliberately not used.
  const result = await receiver.buildPostPriceUpdateInstructions(binary);
  const builder = new TransactionBuilder(keypair.publicKey, connection);
  builder.addInstructions(result.postInstructions);
  for (const item of await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 1000,
  }))
    await send(item.tx, item.signers);
  return {
    accounts: result.priceFeedIdToPriceUpdateAccount,
    cleanup: async () => {
      const builder = new TransactionBuilder(keypair.publicKey, connection);
      builder.addInstructions(result.closeInstructions);
      for (const item of await builder.buildVersionedTransactions({
        computeUnitPriceMicroLamports: 1000,
      }))
        await send(item.tx, item.signers);
    },
  };
}
