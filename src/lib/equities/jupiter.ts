import DecimalBase from "decimal.js";
import { z } from "zod";
import { formatUnits, parseUnits } from "@/lib/amount";
import { USDC } from "@/lib/registry";
import type {
  AggregatedQuote,
  Equity,
  EquitySummary,
  LiveRepresentation,
  MarketsOverview,
  QuoteAlternative,
  Representation,
} from "./types";
import { equityForMint } from "./registry";
import { verifiedRepresentations } from "./onchain";
import { aggregateExecutionQuotes } from "@/lib/execution/aggregate";
import { aggregateIndicativeQuotes } from "@/lib/execution/aggregate";
import { aggregatePoolLiquidity } from "@/lib/execution/liquidity";
import { MARKET_FEE_BPS } from "@/lib/trade-fee";

const Decimal = DecimalBase.clone({
  precision: 60,
  rounding: DecimalBase.ROUND_DOWN,
});
const PRICE_TTL_SECONDS = 15;
const USDC_DECIMALS = 6;
const PROTOCOL_FEE_BPS = BigInt(MARKET_FEE_BPS);

const priceEntrySchema = z.object({
  usdPrice: z.number().positive().optional(),
  liquidity: z.number().nonnegative().optional(),
  decimals: z.number().int().min(0).max(18).optional(),
  priceChange24h: z.number().finite().optional(),
  createdAt: z.string().optional(),
  stockData: z
    .object({
      price: z.number().positive().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
  scaledUiConfig: z
    .object({ multiplier: z.number().positive().optional() })
    .optional(),
});

const statWindowSchema = z
  .object({
    priceChange: z.number().finite().optional(),
    buyVolume: z.number().nonnegative().optional(),
    sellVolume: z.number().nonnegative().optional(),
  })
  .optional();

const tokenEntrySchema = z.object({
  id: z.string(),
  decimals: z.number().int().min(0).max(18).optional(),
  tokenProgram: z.string().optional(),
  liquidity: z.number().nonnegative().optional(),
  mcap: z.number().nonnegative().optional(),
  fdv: z.number().nonnegative().optional(),
  holderCount: z.number().nonnegative().optional(),
  circSupply: z.number().nonnegative().optional(),
  stats5m: statWindowSchema,
  stats1h: statWindowSchema,
  stats6h: statWindowSchema,
  stats24h: statWindowSchema,
});

const topTradedSchema = z.array(z.object({ id: z.string() }));

export type PriceWindows = {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h24: number | null;
};

type JupiterMetadata = {
  price: number | null;
  referencePrice: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  decimals: number | null;
  tokenProgram: string | null;
  multiplier: number;
  marketCapUsd: number | null;
  fullyDilutedUsd: number | null;
  holderCount: number | null;
  priceWindows: PriceWindows;
  asOf: string | null;
};

function apiKey() {
  const key = process.env.JUPITER_API_KEY;
  if (!key) throw new Error("Jupiter market data is not configured.");
  return key;
}

/**
 * Jupiter publishes the same reference data on a keyless, rate-limited host.
 * Preferring the authenticated host when a key exists and falling back to the
 * public one otherwise means a checkout with no credentials still renders real
 * market data rather than a page of unavailable states.
 */
function marketDataHost() {
  return process.env.JUPITER_API_KEY
    ? { base: "https://api.jup.ag", headers: { "x-api-key": apiKey() } }
    : { base: "https://lite-api.jup.ag", headers: {} as Record<string, string> };
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

export async function jupiterMetadata(representations: Representation[]) {
  const result = new Map<string, JupiterMetadata>();
  const unique = [
    ...new Map(representations.map((item) => [item.mint, item])).values(),
  ];
  await Promise.all(
    chunks(unique, 50).map(async (batch) => {
      const observedAt = new Date().toISOString();
      const ids = batch.map((item) => item.mint).join(",");
      const { base, headers } = marketDataHost();
      const [priceResult, tokenResult] = await Promise.allSettled([
        fetch(`${base}/price/v3?ids=${ids}`, {
          headers,
          next: { revalidate: PRICE_TTL_SECONDS },
          signal: AbortSignal.timeout(8_000),
        }).then(async (response) => (response.ok ? response.json() : {})),
        fetch(
          `${base}/tokens/v2/search?query=${encodeURIComponent(ids)}`,
          {
            headers,
            next: { revalidate: 60 },
            signal: AbortSignal.timeout(8_000),
          },
        ).then(async (response) => (response.ok ? response.json() : [])),
      ]);
      const prices =
        priceResult.status === "fulfilled" &&
        typeof priceResult.value === "object" &&
        priceResult.value
          ? (priceResult.value as Record<string, unknown>)
          : {};
      const tokens =
        tokenResult.status === "fulfilled" && Array.isArray(tokenResult.value)
          ? new Map(
              tokenResult.value
                .map((value) => tokenEntrySchema.safeParse(value))
                .filter((value) => value.success)
                .map((value) => [value.data.id, value.data]),
            )
          : new Map();
      for (const representation of batch) {
        const parsed = priceEntrySchema.safeParse(prices[representation.mint]);
        const price = parsed.success ? parsed.data : null;
        const token = tokens.get(representation.mint);
        const volume = token?.stats24h
          ? (token.stats24h.buyVolume ?? 0) + (token.stats24h.sellVolume ?? 0)
          : null;
        const change = (window: z.infer<typeof statWindowSchema>) =>
          typeof window?.priceChange === "number" ? window.priceChange : null;
        result.set(representation.mint, {
          marketCapUsd: token?.mcap ?? null,
          fullyDilutedUsd: token?.fdv ?? null,
          holderCount: token?.holderCount ?? null,
          priceWindows: {
            m5: change(token?.stats5m),
            h1: change(token?.stats1h),
            h6: change(token?.stats6h),
            h24: change(token?.stats24h) ?? price?.priceChange24h ?? null,
          },
          price: price?.usdPrice ?? null,
          referencePrice: price?.stockData?.price ?? null,
          liquidity: price?.liquidity ?? token?.liquidity ?? null,
          priceChange24h: price?.priceChange24h ?? null,
          volume24h: volume,
          decimals: price?.decimals ?? token?.decimals ?? null,
          tokenProgram: token?.tokenProgram ?? null,
          multiplier: price?.scaledUiConfig?.multiplier ?? 1,
          asOf: price ? (price.stockData?.updatedAt ?? observedAt) : null,
        });
      }
    }),
  );
  return result;
}

function sumAvailable(values: (number | null)[]) {
  const available = values.filter((value): value is number => value !== null);
  return available.length
    ? available.reduce((sum, value) => sum + value, 0)
    : null;
}

export function normalizedPriceImpact(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value.trim().replace(/%$/, ""));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : null;
}

export async function summarizeEquities(
  equities: Equity[],
): Promise<EquitySummary[]> {
  let metadata = new Map<string, JupiterMetadata>();
  try {
    metadata = await jupiterMetadata(
      equities.flatMap((equity) => equity.representations),
    );
  } catch {
    // Static registry data remains useful when the live source is unavailable.
  }
  return equities.map(({ representations, ...equity }) => {
    const ranked = representations
      .map((representation) => ({
        representation,
        live: metadata.get(representation.mint),
      }))
      .filter((entry) => entry.live)
      .sort((a, b) => (b.live?.liquidity ?? -1) - (a.live?.liquidity ?? -1));
    /* The reference is the underlying stock's price, which belongs to the
       company rather than to any one mint: the same figure comes back from
       every representation that reports it. Taking it from the most liquid
       representation alone leaves a company blank whenever that one mint has
       no feed, so read across them and use the first that reports. */
    const first = <T,>(read: (live: JupiterMetadata) => T | null): T | null => {
      for (const entry of ranked) {
        const value = entry.live ? read(entry.live) : null;
        if (value !== null && value !== undefined) return value;
      }
      return null;
    };
    return {
      ...equity,
      representationCount: representations.length,
      providers: [
        ...new Set(
          representations.map((representation) => representation.provider),
        ),
      ],
      representationSymbols: representations.map((representation) => ({
        provider: representation.provider,
        tokenSymbol: representation.tokenSymbol,
      })),
      price:
        first((live) => live.referencePrice) ??
        first((live) => live.price) ??
        null,
      priceChange24hPct: first((live) => live.priceChange24h) ?? null,
      onchainVolume24hUsd: sumAvailable(
        representations.map(
          (representation) =>
            metadata.get(representation.mint)?.volume24h ?? null,
        ),
      ),
      liquidityUsd: sumAvailable(
        representations.map(
          (representation) =>
            metadata.get(representation.mint)?.liquidity ?? null,
        ),
      ),
      bestSpreadPct: null,
      recentlyTokenizedAt: null,
    };
  });
}

export async function marketsOverview(): Promise<MarketsOverview> {
  const response = await fetch(
    "https://lite-api.jup.ag/tokens/v2/toptraded/24h?limit=100",
    {
      next: { revalidate: PRICE_TTL_SECONDS },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error("Market overview is unavailable.");
  const parsed = topTradedSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Market overview is unavailable.");

  const equities = [
    ...new Map(
      parsed.data
        .map((token) => equityForMint(token.id)?.equity)
        .filter((equity): equity is Equity => Boolean(equity))
        .map((equity) => [equity.id, equity]),
    ).values(),
  ];
  const items = await summarizeEquities(equities);
  items.sort(
    (a, b) =>
      (b.onchainVolume24hUsd ?? -1) - (a.onchainVolume24hUsd ?? -1) ||
      a.ticker.localeCompare(b.ticker),
  );
  const availableVolumes = items
    .map((item) => item.onchainVolume24hUsd)
    .filter((value): value is number => value !== null);

  // Which issuer the traded volume actually sits with. The metadata call is
  // already cached from summarizeEquities, so this costs nothing extra.
  const providerVolume: Record<string, number> = {};
  try {
    const metadata = await jupiterMetadata(
      equities.flatMap((equity) => equity.representations),
    );
    for (const equity of equities) {
      for (const representation of equity.representations) {
        const volume = metadata.get(representation.mint)?.volume24h;
        if (typeof volume === "number" && volume > 0) {
          providerVolume[representation.provider] =
            (providerVolume[representation.provider] ?? 0) + volume;
        }
      }
    }
  } catch {
    // A missing split leaves the tile showing the headline figure alone.
  }

  return {
    items,
    providerVolume,
    totalVolume24hUsd: availableVolumes.length
      ? availableVolumes.reduce((sum, value) => sum + value, 0)
      : null,
    sourceTokenCount: parsed.data.length,
    matchedCompanyCount: items.length,
    asOf: new Date().toISOString(),
  };
}

function decimalUi(raw: bigint, decimals: number, multiplier = 1) {
  return new Decimal(formatUnits(raw, decimals)).mul(multiplier);
}

export async function quoteRepresentation(
  representation: Representation,
  side: "buy" | "sell",
  amount: string,
  knownMetadata?: JupiterMetadata,
  indicative = false,
): Promise<QuoteAlternative> {
  const metadata =
    knownMetadata ??
    (await jupiterMetadata([representation])).get(representation.mint);
  if (metadata?.decimals === null || metadata?.decimals === undefined)
    throw new Error("Token decimals are unavailable.");
  let inputMint: string,
    outputMint: string,
    rawInput: bigint,
    grossInput: DecimalBase;
  if (side === "buy") {
    grossInput = new Decimal(amount);
    const total = parseUnits(grossInput.toFixed(USDC_DECIMALS), USDC_DECIMALS);
    const fee = (total * PROTOCOL_FEE_BPS) / 10_000n;
    rawInput = total - fee;
    inputMint = USDC;
    outputMint = representation.mint;
  } else {
    grossInput = new Decimal(amount);
    const prescaled = grossInput.div(metadata.multiplier);
    rawInput = parseUnits(
      prescaled.toFixed(metadata.decimals),
      metadata.decimals,
    );
    inputMint = representation.mint;
    outputMint = USDC;
  }
  if (rawInput <= 0n) throw new Error("Quote amount is too small.");
  const aggregate = await (
    indicative ? aggregateIndicativeQuotes : aggregateExecutionQuotes
  )({
    inputMint,
    outputMint,
    amount: rawInput,
    slippageBps: 50,
  });
  const quote = aggregate.selected;
  if (!quote) throw new Error("No executable route from any quote source.");
  const rawOutput = BigInt(quote.outputAmount);
  const threshold = BigInt(quote.minimumOutputAmount);
  const outputFee =
    side === "sell" ? (rawOutput * PROTOCOL_FEE_BPS) / 10_000n : 0n;
  const inputFee =
    side === "buy"
      ? (parseUnits(grossInput.toFixed(USDC_DECIMALS), USDC_DECIMALS) *
          PROTOCOL_FEE_BPS) /
        10_000n
      : 0n;
  const received =
    side === "buy"
      ? decimalUi(rawOutput, metadata.decimals, metadata.multiplier)
      : decimalUi(rawOutput - outputFee, USDC_DECIMALS);
  const minimum =
    side === "buy"
      ? decimalUi(threshold, metadata.decimals, metadata.multiplier)
      : decimalUi(
          threshold - (threshold * PROTOCOL_FEE_BPS) / 10_000n,
          USDC_DECIMALS,
        );
  const effectivePrice =
    side === "buy" ? grossInput.div(received) : received.div(grossInput);
  return {
    routeType: "DEX",
    eligibilityRequirements: [
      "Connected Solana wallet",
      "Venue and issuer eligibility",
    ],
    settlementNotes:
      "Solana swap; network fee is not included in this comparison.",
    representationId: representation.id,
    provider: representation.provider,
    tokenSymbol: representation.tokenSymbol,
    mint: representation.mint,
    route: quote.route.map((step) => ({
      label: step.venue,
      percent: step.percent ?? 100,
    })),
    effectivePrice: effectivePrice.toSignificantDigits(12).toString(),
    inputAmount: amount,
    expectedReceivedAmount: received.toSignificantDigits(16).toString(),
    minimumReceivedAmount: minimum?.toSignificantDigits(16).toString() ?? null,
    priceImpactPct: quote.priceImpactPct ?? null,
    protocolFeeAmount: formatUnits(
      side === "buy" ? inputFee : outputFee,
      USDC_DECIMALS,
    ),
    networkFeeAmount: null,
    executionSource: quote.source,
    quoteProvider: quote.quoteProvider,
    providerFeeBps: quote.providerFeeBps,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
  };
}

export async function aggregateQuote(
  equity: Equity,
  side: "buy" | "sell",
  amount: string,
): Promise<AggregatedQuote> {
  const metadata = await jupiterMetadata(equity.representations);
  const settled = await Promise.allSettled(
    equity.representations.map((representation) =>
      quoteRepresentation(
        representation,
        side,
        amount,
        metadata.get(representation.mint),
      ),
    ),
  );
  const alternatives = settled
    .filter(
      (result): result is PromiseFulfilledResult<QuoteAlternative> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .sort((a, b) =>
      new Decimal(b.expectedReceivedAmount).cmp(a.expectedReceivedAmount),
    );
  if (!alternatives.length)
    throw new Error(
      "No executable representation is available for this amount.",
    );
  const quotedAt = new Date();
  return {
    equity: equity.ticker,
    side,
    selectedRepresentation: alternatives[0],
    alternatives,
    quotedAt: quotedAt.toISOString(),
    expiresAt: new Date(quotedAt.getTime() + 15_000).toISOString(),
    executable: false,
  };
}

export async function onchainComparison(equity: Equity): Promise<{
  representations: LiveRepresentation[];
  bestBuy: string | null;
  bestSell: string | null;
  bestExecution: string | null;
  executionQuotes: QuoteAlternative[];
  comparisonNotionalUsd: number;
  bestExecutionNotionalUsd: number;
  asOf: string;
}> {
  let metadata = new Map<string, JupiterMetadata>();
  let verified = equity.representations;
  const poolPromise = Promise.allSettled(
    equity.representations.map((representation) =>
      aggregatePoolLiquidity(USDC, representation.mint),
    ),
  );
  const [marketResult, verificationResult] = await Promise.allSettled([
    jupiterMetadata(equity.representations),
    verifiedRepresentations(equity),
  ]);
  if (marketResult.status === "fulfilled") metadata = marketResult.value;
  if (verificationResult.status === "fulfilled")
    verified = verificationResult.value;
  const quoteSets: {
    representation: Representation;
    live: JupiterMetadata | undefined;
    settled: PromiseSettledResult<QuoteAlternative>[];
  }[] = [];
  const settle = async (
    task: () => Promise<QuoteAlternative>,
  ): Promise<PromiseSettledResult<QuoteAlternative>> => {
    try {
      return { status: "fulfilled", value: await task() };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  };
  const initialQuotes = await Promise.all(
    equity.representations.map((representation) => {
      const live = metadata.get(representation.mint);
      return settle(() =>
        quoteRepresentation(representation, "buy", "1000", live, true),
      );
    }),
  );
  const followups: Array<{
    row: number;
    slot: number;
    run: () => Promise<QuoteAlternative>;
  }> = [];
  for (const [row, representation] of equity.representations.entries()) {
    const live = metadata.get(representation.mint);
    const results: PromiseSettledResult<QuoteAlternative>[] = [
      initialQuotes[row],
      { status: "rejected", reason: "Initial route unavailable." },
      { status: "rejected", reason: "Initial route unavailable." },
      { status: "rejected", reason: "Initial route unavailable." },
    ];
    const sellAmount =
      live?.referencePrice && live.referencePrice > 0
        ? new Decimal(1000)
            .div(live.referencePrice)
            .toSignificantDigits(16)
            .toString()
        : "1";
    if (initialQuotes[row].status === "fulfilled") {
      for (const [slot, side, amount] of [
        [1, "buy", "10000"],
        [2, "buy", "50000"],
        [3, "sell", sellAmount],
      ] as const) {
        followups.push({
          row,
          slot,
          run: () =>
            quoteRepresentation(representation, side, amount, live, true),
        });
      }
    }
    quoteSets.push({ representation, live, settled: results });
  }
  let nextTask = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, followups.length) }, async () => {
      while (nextTask < followups.length) {
        const task = followups[nextTask++];
        quoteSets[task.row].settled[task.slot] = await settle(task.run);
      }
    }),
  );
  const poolResults = await poolPromise;
  /* One reference for the company, not one per mint. The figure is the
     underlying stock's price, so every representation that reports it reports
     the same number; a representation with no feed of its own is still a claim
     on the same security. Without this a mint that no DEX indexes - Backpack's
     tokens trade on its own venue rather than an AMM - shows no reference at
     all, and its premium against the underlying cannot be computed. */
  const companyReference =
    quoteSets.find(({ live }) => (live?.referencePrice ?? 0) > 0)?.live
      ?.referencePrice ?? null;
  const rows = quoteSets.map(
    ({ representation, live, settled }, rowIndex): LiveRepresentation => {
      const value = (index: number) =>
        settled[index].status === "fulfilled" ? settled[index].value : null;
      const buy = value(0),
        sell = value(3);
      const buyPrice = buy ? Number(buy.effectivePrice) : null;
      const sellPrice = sell ? Number(sell.effectivePrice) : null;
      const mid =
        buyPrice !== null && sellPrice !== null
          ? (buyPrice + sellPrice) / 2
          : null;
      const poolResult = poolResults[rowIndex];
      const pools =
        poolResult.status === "fulfilled" ? poolResult.value.pools : [];
      const uniquePools = [
        ...new Map(
          pools.map((pool) => [`${pool.source}:${pool.pool}`, pool]),
        ).values(),
      ];
      const poolLiquidity = sumAvailable(
        uniquePools.map((pool) => pool.liquidityUsd),
      );
      const poolVolume = sumAvailable(
        uniquePools.map((pool) => pool.volume24hUsd),
      );
      const executionSources = [
        ...new Set(
          settled.flatMap((result) =>
            result.status === "fulfilled" ? [result.value.executionSource] : [],
          ),
        ),
      ];
      return {
        representationId: representation.id,
        provider: representation.provider,
        tokenSymbol: representation.tokenSymbol,
        mint: representation.mint,
        tokenProgram:
          verified.find((item) => item.id === representation.id)
            ?.tokenProgram ??
          live?.tokenProgram ??
          representation.tokenProgram,
        decimals:
          verified.find((item) => item.id === representation.id)?.decimals ??
          live?.decimals ??
          representation.decimals,
        executableBuyPrice: buyPrice,
        executableSellPrice: sellPrice,
        referencePrice: live?.referencePrice ?? companyReference,
        premiumDiscountPct:
          buyPrice !== null && (live?.referencePrice ?? companyReference)
            ? (buyPrice / (live?.referencePrice ?? companyReference)! - 1) * 100
            : null,
        spreadPct:
          mid && buyPrice !== null && sellPrice !== null
            ? ((buyPrice - sellPrice) / mid) * 100
            : null,
        liquidityUsd: poolLiquidity ?? live?.liquidity ?? null,
        volume24hUsd: poolVolume ?? live?.volume24h ?? null,
        priceChange24hPct: live?.priceChange24h ?? null,
        marketCapUsd: live?.marketCapUsd ?? null,
        fullyDilutedUsd: live?.fullyDilutedUsd ?? null,
        holderCount: live?.holderCount ?? null,
        priceWindows: live?.priceWindows ?? {
          m5: null,
          h1: null,
          h6: null,
          h24: null,
        },
        priceImpactPct: {
          "1000": normalizedPriceImpact(buy?.priceImpactPct ?? null),
          "10000": normalizedPriceImpact(value(1)?.priceImpactPct ?? null),
          "50000": normalizedPriceImpact(value(2)?.priceImpactPct ?? null),
        },
        jupiterRouteAvailable: settled.some(
          (result) =>
            result.status === "fulfilled" &&
            result.value.quoteProvider === "jupiter",
        ),
        executionSources,
        liquiditySources: uniquePools.length
          ? [...new Set(uniquePools.map((pool) => pool.source))]
          : live?.liquidity !== null && live?.liquidity !== undefined
            ? ["jupiter"]
            : [],
        poolCount: uniquePools.length,
        quoteAsOf:
          settled.find(
            (result): result is PromiseFulfilledResult<QuoteAlternative> =>
              result.status === "fulfilled",
          )?.value.quotedAt ?? null,
        marketStatus: settled.some((result) => result.status === "fulfilled")
          ? "active"
          : "unavailable",
        asOf: live?.asOf ?? null,
      };
    },
  );
  const buy = rows
    .filter((row) => row.executableBuyPrice !== null)
    .sort((a, b) => a.executableBuyPrice! - b.executableBuyPrice!)[0];
  const sell = rows
    .filter((row) => row.executableSellPrice !== null)
    .sort((a, b) => b.executableSellPrice! - a.executableSellPrice!)[0];
  const executionIndex = quoteSets
    .map((set, index) => ({
      index,
      quote:
        set.settled[1].status === "fulfilled" ? set.settled[1].value : null,
    }))
    .filter(
      (entry): entry is { index: number; quote: QuoteAlternative } =>
        entry.quote !== null,
    )
    .sort((a, b) =>
      new Decimal(b.quote.expectedReceivedAmount).cmp(
        a.quote.expectedReceivedAmount,
      ),
    )[0]?.index;
  const execution =
    executionIndex === undefined ? undefined : rows[executionIndex];
  return {
    executionQuotes: quoteSets.flatMap((set) =>
      set.settled[1].status === "fulfilled" ? [set.settled[1].value] : [],
    ),
    representations: rows,
    bestBuy: buy?.representationId ?? null,
    bestSell: sell?.representationId ?? null,
    bestExecution: execution?.representationId ?? null,
    comparisonNotionalUsd: 1000,
    bestExecutionNotionalUsd: 10000,
    asOf: new Date().toISOString(),
  };
}
