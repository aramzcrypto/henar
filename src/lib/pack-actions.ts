import { PublicKey } from "@solana/web3.js";
import { packQuote } from "./earn-accounting";
import { PACK_PRICE } from "./product-config";
const U64_MAX = 18446744073709551615n;
export function packQuantity(input: string): bigint {
  if (!/^\d{1,13}$/.test(input))
    throw new Error("Enter a whole number of packs.");
  const quantity = BigInt(input);
  if (quantity < 1n || quantity * PACK_PRICE > U64_MAX)
    throw new Error("Pack quantity is out of range.");
  return quantity;
}
export function batchPackQuote(input: string, feeBps: number) {
  const quantity = packQuantity(input);
  const perPack = packQuote("Purchased", feeBps);
  return {
    quantity,
    price: perPack.price * quantity,
    fee: perPack.fee * quantity,
    stockValue: perPack.stockValue * quantity,
  };
}
export function giftDraft(
  recipient: string,
  message: string,
  quantity: string,
  sender?: string,
) {
  const address = recipient.trim();
  let key: PublicKey;
  try {
    key = new PublicKey(address);
  } catch {
    throw new Error("Enter a valid Solana wallet address.");
  }
  if (!PublicKey.isOnCurve(key.toBytes()))
    throw new Error("Use a Solana wallet address, not a program address.");
  if (key.toBase58() === sender)
    throw new Error("Choose a different recipient wallet.");
  if (
    [...message].length > 280 ||
    new TextEncoder().encode(message).length > 1024
  )
    throw new Error(
      "Message is too long (280 characters / 1,024 bytes maximum).",
    );
  return {
    recipient: key.toBase58(),
    message,
    quantity: packQuantity(quantity),
  };
}
