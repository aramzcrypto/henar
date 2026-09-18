/**
 * Byreal CLMM discovery and liquidity census.
 *
 * Byreal is Bybit's Solana DEX and an RWA liquidity hub. It holds tokenized
 * equity pools that no aggregator Henar races routes to: across 84 winning
 * Jupiter routes for Henar's listed equities, Byreal never appeared once. That
 * makes it liquidity the whole market is ignoring rather than liquidity
 * already priced in, which is the only kind worth adding a venue for.
 *
 * Every pool is read from chain, never from an index. A pool is kept when its
 * two mints are exactly {verified representation, USDC}; anything else is
 * recorded as non-routable with the reason, because the equity engine quotes
 * USDC <-> representation and nothing else.
 *
 * **TVL is not the admission test.** The spec this implements is explicit, and
 * so is the evidence: a pool with a large nominal balance but a narrow
 * concentrated range can fill less at $10,000 than a shallower pool with a
 * wider one. So each pool is quoted at real order sizes through Byreal's own
 * SDK and admitted on what it can actually fill. `depth` records the largest
 * size that filled completely.
 *
 * Requires SOLANA_RPC_URL. Without it the script writes nothing and exits
 * non-zero: an empty artifact reads as "no pools exist", which is not known.
 */
import { writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { equityRegistry } from "../../src/lib/equities/registry";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OUTPUT = "src/data/router/byreal-discovery.json";
const POOL_STATE_BYTES = 1544;

/** The order sizes the census measures, in whole USDC. */
const SIZES = [100, 1_000, 5_000, 10_000, 25_000, 50_000];

type SizeQuote = {
  sizeUsd: number;
  /** Base units out, or null when the pool cannot fill that size. */
  amountOut: string | null;
  /** Fee in input base units, as the SDK reports it. */
  feeAmount: string | null;
  /** Against the pool's own spot price, in bps. Negative is worse for the taker. */
  priceImpactBps: number | null;
  filled: boolean;
};

type ByrealPool = {
  address: string;
  mint: string;
  representationId: string;
  provider: string;
  tokenSymbol: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  tickSpacing: number;
  feeBps: number | null;
  liquidity: string;
  sqrtPriceX64: string;
  /** Largest size in SIZES that filled completely, 0 when none did. */
  depthUsd: number;
  quotes: SizeQuote[];
  slot: number;
  fetchedAt: string;
  error: string | null;
};

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required for Byreal discovery.");

  const sdk = await import("@byreal-io/byreal-clmm-sdk");
  const { PoolLayout, AmmConfigLayout, PoolUtils, getTickArrayInfo, getTickArrayBitmapExtension, BYREAL_CLMM_PROGRAM_ID } = sdk;

  const verified = new Map<string, { representationId: string; provider: string; tokenSymbol: string }>();
  for (const equity of equityRegistry)
    for (const r of equity.representations)
      if (r.providerStatus === "verified")
        verified.set(r.mint, { representationId: r.id, provider: r.provider, tokenSymbol: r.tokenSymbol });

  const connection = new Connection(rpc, "confirmed");
  /* The SDK bundles its own @solana/web3.js, so its Connection is a
     structurally identical but nominally different type. One cast at the
     boundary is honest; threading a second web3.js through the codebase to
     satisfy the compiler would not be. */
  const sdkConnection = connection as unknown as Parameters<typeof getTickArrayInfo>[0]["connection"];
  process.stdout.write(`Reading Byreal CLMM pool states (${String(BYREAL_CLMM_PROGRAM_ID)})…\n`);
  const accounts = await connection.getProgramAccounts(new PublicKey(BYREAL_CLMM_PROGRAM_ID), {
    commitment: "confirmed",
    filters: [{ dataSize: POOL_STATE_BYTES }],
  });
  process.stdout.write(`  ${accounts.length} pools on chain\n`);

  const fetchedAt = new Date().toISOString();
  const slot = await connection.getSlot("confirmed");
  const kept: ByrealPool[] = [];
  const rejected: Record<string, number> = {};
  const reject = (why: string) => {
    rejected[why] = (rejected[why] ?? 0) + 1;
  };

  for (const { pubkey, account } of accounts) {
    let pool: ReturnType<typeof PoolLayout.decode>;
    try {
      pool = PoolLayout.decode(account.data);
    } catch {
      reject("pool state could not be decoded");
      continue;
    }
    const mintA = pool.mintA.toBase58();
    const mintB = pool.mintB.toBase58();
    const equityMint = verified.has(mintA) ? mintA : verified.has(mintB) ? mintB : null;
    if (!equityMint) continue; // Not an equity pool; not this script's business.
    const other = equityMint === mintA ? mintB : mintA;
    if (other !== USDC) {
      reject("equity pool whose other side is not USDC");
      continue;
    }
    const rep = verified.get(equityMint)!;

    const row: ByrealPool = {
      address: pubkey.toBase58(),
      mint: equityMint,
      representationId: rep.representationId,
      provider: rep.provider,
      tokenSymbol: rep.tokenSymbol,
      baseMint: mintA,
      quoteMint: mintB,
      baseDecimals: pool.mintDecimalsA,
      quoteDecimals: pool.mintDecimalsB,
      tickSpacing: pool.tickSpacing,
      feeBps: null,
      liquidity: pool.liquidity.toString(),
      sqrtPriceX64: pool.sqrtPriceX64.toString(),
      depthUsd: 0,
      quotes: [],
      slot,
      fetchedAt,
      error: null,
    };

    try {
      /* The SDK's quote takes the decoded state plus its identity and spot
         price; `currentPrice` is quote-per-base derived from the pool's own
         sqrt price, which is the same number every other field is consistent
         with. */
      const spotPrice = (Number(pool.sqrtPriceX64.toString()) / 2 ** 64) ** 2;
      const poolInfo = {
        ...pool,
        id: pubkey,
        poolId: pubkey,
        programId: new PublicKey(BYREAL_CLMM_PROGRAM_ID),
        currentPrice: spotPrice,
      } as unknown as Parameters<typeof PoolUtils.getOutputAmountAndRemainAccounts>[0]["poolInfo"];
      const [configAccount, exBitmapInfo] = await Promise.all([
        connection.getAccountInfo(pool.ammConfig, "confirmed"),
        getTickArrayBitmapExtension(new PublicKey(BYREAL_CLMM_PROGRAM_ID), pubkey, sdkConnection),
      ]);
      if (!configAccount) throw new Error("amm config account not found");
      const ammConfig = AmmConfigLayout.decode(configAccount.data);
      row.feeBps = Math.round(Number(ammConfig.tradeFeeRate) / 100); // 1e6 denominator -> bps
      const tickArrayInfo = await getTickArrayInfo({ connection: sdkConnection, poolInfo, exBitmapInfo });

      /* Spot is read once from the pool's own sqrt price, so impact is measured
         against the pool rather than against an external mark that may differ
         for reasons the pool is not responsible for. */
      const spot = spotPrice;
      const quoteIsB = row.quoteMint === USDC;

      for (const sizeUsd of SIZES) {
        const inputAmount = new BN(sizeUsd).mul(new BN(10).pow(new BN(quoteIsB ? row.quoteDecimals : row.baseDecimals)));
        try {
          const out = PoolUtils.getOutputAmountAndRemainAccounts({
            poolInfo,
            exBitmapInfo,
            ammConfig,
            tickArrayInfo,
            inputTokenMint: new PublicKey(USDC),
            inputAmount,
            catchLiquidityInsufficient: true,
          });
          const amountOut = out.expectedAmountOut.toString();
          const outUnits = Number(amountOut) / 10 ** (quoteIsB ? row.baseDecimals : row.quoteDecimals);
          /* Spot here is quote-per-base when USDC is mintB, so the frictionless
             output is size / spot. Impact is what the taker gave up against it. */
          const frictionless = quoteIsB ? sizeUsd / spot : sizeUsd * spot;
          const impact = frictionless > 0 ? Math.round(((outUnits - frictionless) / frictionless) * 10_000) : null;
          row.quotes.push({
            sizeUsd,
            amountOut,
            feeAmount: out.feeAmount.toString(),
            priceImpactBps: impact,
            filled: out.allTrade,
          });
          if (out.allTrade && Number(amountOut) > 0) row.depthUsd = sizeUsd;
        } catch (error) {
          row.quotes.push({ sizeUsd, amountOut: null, feeAmount: null, priceImpactBps: null, filled: false });
          void error;
        }
      }
    } catch (error) {
      row.error = (error as Error).message;
    }

    kept.push(row);
    const depth = row.depthUsd ? `$${row.depthUsd.toLocaleString("en-US")}` : "nothing";
    process.stdout.write(`  ${row.tokenSymbol.padEnd(9)} ${row.address.slice(0, 8)} fee=${row.feeBps ?? "?"}bps fills ${depth}${row.error ? ` (${row.error})` : ""}\n`);
  }

  kept.sort((a, b) => (b.depthUsd - a.depthUsd) || a.tokenSymbol.localeCompare(b.tokenSymbol));
  await writeFile(OUTPUT, `${JSON.stringify({ program: String(BYREAL_CLMM_PROGRAM_ID), fetchedAt, slot, sizes: SIZES, pools: kept }, null, 2)}\n`, "utf8");
  const usable = kept.filter((p) => p.depthUsd >= 1_000).length;
  process.stdout.write(`\nWrote ${OUTPUT}: ${kept.length} equity/USDC pools, ${usable} filling $1,000 or more.\n`);
  for (const [why, n] of Object.entries(rejected)) process.stdout.write(`  rejected ${n}: ${why}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
