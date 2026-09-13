import { USDC } from "./registry";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export type PaymentToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  provider?: string;
};
export const PAYMENT_USDC: PaymentToken = {
  mint: USDC,
  symbol: "USDC",
  name: "USD Coin",
  logo: "/logos/tokens/usdc.png",
  decimals: 6,
};
export const PAYMENT_SOL: PaymentToken = {
  mint: SOL_MINT,
  symbol: "SOL",
  name: "Solana",
  logo: "/logos/tokens/sol.png",
  decimals: 9,
};
export const commonPayments = [PAYMENT_USDC, PAYMENT_SOL];
export function paymentForMode(
  mode: string,
  selected: PaymentToken,
): PaymentToken {
  return mode === "market" ? selected : PAYMENT_USDC;
}
export function paymentLabel(mint: string): string {
  return (
    commonPayments.find((t) => t.mint === mint)?.symbol ??
    `${mint.slice(0, 4)}…${mint.slice(-4)}`
  );
}
export function resolveFeeAccount(
  inputMint: string,
  outputMint: string,
  accounts: Record<string, string>,
  legacyUsdc?: string,
) {
  const address =
    accounts[inputMint] || (inputMint === USDC ? legacyUsdc : undefined);
  if (address) return { address, mint: inputMint };
  if (accounts[outputMint])
    return { address: accounts[outputMint], mint: outputMint };
  throw new Error("Protocol fee collection is not configured for this pair.");
}

/** Prefer stablecoin fees, then the input token; native SOL fees use output. */
export function feeOnInput(inputMint: string, outputMint: string) {
  if (inputMint === USDC) return true;
  if (outputMint === USDC) return false;
  return inputMint !== SOL_MINT;
}
export function accountFunding(
  before: bigint,
  after: bigint,
  network: bigint,
  inputMint: string,
  amount: bigint,
) {
  return before - after - network - (inputMint === SOL_MINT ? amount : 0n);
}
