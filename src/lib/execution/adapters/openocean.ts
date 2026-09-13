import { z } from "zod";
import type { ExecutionQuoteRequest, NormalizedExecutionQuote } from "../types";
import { QUOTE_TTL_MS, validateExecutionRequest } from "../shared";

export const OPENOCEAN_PROVIDER_FEE_BPS = 15;
const OPENOCEAN_MIN_REQUEST_INTERVAL_MS = 350;
let openOceanGate: Promise<void> = Promise.resolve();
let nextOpenOceanRequestAt = 0;

const tokenSchema = z.object({
  address: z.string(),
  decimals: z.number().int().nonnegative(),
});

const dexSchema = z.object({
  dexCode: z.string(),
  dexIndex: z.number().int().optional(),
  swapAmount: z.string().regex(/^\d+$/).optional(),
  minOutAmount: z.string().regex(/^\d+$/).optional(),
});

const schema = z.object({
  code: z.number().int(),
  data: z.object({
    code: z.number().int(),
    inToken: tokenSchema,
    outToken: tokenSchema,
    inAmount: z.string().regex(/^\d+$/),
    outAmount: z.string().regex(/^\d+$/),
    minOutAmount: z.string().regex(/^\d+$/),
    dexId: z.number().int().optional(),
    dexes: z.array(dexSchema).default([]),
    price_impact: z.union([z.string(), z.number()]).optional(),
  }),
});

function endpoint() {
  const value = process.env.OPENOCEAN_API_URL?.replace(/\/$/, "");
  if (!value) throw new Error("OpenOcean is not configured.");
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("OpenOcean is not configured securely.");
  return url.toString().replace(/\/$/, "");
}

function deductFee(amount: bigint) {
  const fee = (amount * BigInt(OPENOCEAN_PROVIDER_FEE_BPS)) / 10_000n;
  return { fee, net: amount - fee };
}

async function respectOpenOceanRateLimit() {
  const previous = openOceanGate;
  let release = () => {};
  openOceanGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const delay = Math.max(0, nextOpenOceanRequestAt - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  nextOpenOceanRequestAt = Date.now() + OPENOCEAN_MIN_REQUEST_INTERVAL_MS;
  release();
}

export async function quoteOpenOcean(
  request: ExecutionQuoteRequest,
): Promise<NormalizedExecutionQuote> {
  validateExecutionRequest(request);
  const params = new URLSearchParams({
    inTokenAddress: request.inputMint,
    outTokenAddress: request.outputMint,
    amountDecimals: request.amount.toString(),
    gasPriceDecimals: "0",
  });
  await respectOpenOceanRateLimit();
  const response = await fetch(`${endpoint()}/v4/solana/quote?${params}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("No route from OpenOcean.");
  const value = schema.parse(await response.json());
  const data = value.data;
  const grossOutput = BigInt(data.outAmount);
  const grossMinimum = BigInt(data.minOutAmount);
  if (
    value.code !== 200 ||
    data.code !== 0 ||
    data.inToken.address !== request.inputMint ||
    data.outToken.address !== request.outputMint ||
    data.inAmount !== request.amount.toString() ||
    grossOutput <= 0n ||
    grossMinimum <= 0n ||
    grossMinimum > grossOutput
  )
    throw new Error("OpenOcean quote terms did not match the request.");

  const output = deductFee(grossOutput);
  const minimum = deductFee(grossMinimum);
  if (output.net <= 0n || minimum.net <= 0n || minimum.net > output.net)
    throw new Error("OpenOcean returned invalid net output.");
  const selected = data.dexes.find((dex) => dex.swapAmount === data.outAmount);
  const now = Date.now();
  return {
    source: "openocean",
    quoteProvider: "openocean",
    quoteId: data.dexId === undefined ? null : String(data.dexId),
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inputAmount: request.amount.toString(),
    grossOutputAmount: grossOutput.toString(),
    outputAmount: output.net.toString(),
    minimumOutputAmount: minimum.net.toString(),
    providerFeeBps: OPENOCEAN_PROVIDER_FEE_BPS,
    providerFeeAmount: output.fee.toString(),
    priceImpactPct:
      data.price_impact === undefined ? null : String(data.price_impact),
    route: [
      {
        venue: selected?.dexCode ?? "OpenOcean route",
        pool: null,
        percent: 100,
      },
    ],
    contextSlot: null,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    transactionAvailable: false,
  };
}
