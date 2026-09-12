export const categories = ["Random", "AI", "Tech", "Space", "Crypto"] as const;
export type Category = (typeof categories)[number];
export type ProductConfig = { yieldShareBps: number; packFeeBps: number };
export function validateBps(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10000)
    throw new Error(
      "Fee must be an integer between 0 and 10,000 basis points.",
    );
  return value;
}
export function getProductConfig(): ProductConfig {
  return {
    yieldShareBps: validateBps(
      Number(process.env.STOCKROOM_YIELD_SHARE_BPS ?? "1000"),
    ),
    packFeeBps: validateBps(
      Number(process.env.STOCKROOM_PACK_FEE_BPS ?? "200"),
    ),
  };
}
export const PACK_PRICE = 10_000_000n;
export function percent(bps: number) {
  return `${bps / 100}%`;
}
