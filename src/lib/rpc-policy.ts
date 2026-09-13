import { z } from "zod";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
const key = z
  .string()
  .max(44)
  .refine((v) => {
    try {
      new PublicKey(v);
      return true;
    } catch {
      return false;
    }
  });
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const commitment = z.enum(["processed", "confirmed", "finalized"]);
const context = z
  .object({
    commitment: commitment.optional(),
    minContextSlot: z.number().int().nonnegative().optional(),
  })
  .strict();
const account = context.extend({
  encoding: z.literal("base64").optional(),
  dataSlice: z
    .object({
      offset: z.number().int().min(0).max(10000000),
      length: z.number().int().min(0).max(100000),
    })
    .optional(),
});
const transaction = z
  .string()
  .max(1644)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .refine((v) => {
    try {
      const b = Buffer.from(v, "base64");
      return (
        b.length <= 1232 &&
        b.toString("base64") === v &&
        !!VersionedTransaction.deserialize(b)
      );
    } catch {
      return false;
    }
  });
const schemas: Record<string, z.ZodTypeAny> = {
  getLatestBlockhash: z.tuple([context.optional()]),
  getBlockHeight: z.tuple([context.optional()]),
  getVersion: z.tuple([]),
  getBalance: z.tuple([key, context.optional()]),
  getAccountInfo: z.tuple([key, account.optional()]),
  getMultipleAccounts: z.tuple([
    z.array(key).min(1).max(20),
    account.optional(),
  ]),
  getSignatureStatuses: z.tuple([
    z.array(signature).min(1).max(20),
    z
      .object({ searchTransactionHistory: z.boolean().optional() })
      .strict()
      .optional(),
  ]),
  getFeeForMessage: z.tuple([
    z
      .string()
      .max(1644)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    context.optional(),
  ]),
  simulateTransaction: z.tuple([
    transaction,
    context
      .extend({
        encoding: z.literal("base64"),
        sigVerify: z.boolean().optional(),
        replaceRecentBlockhash: z.boolean().optional(),
        innerInstructions: z.boolean().optional(),
        accounts: z
          .object({
            encoding: z.literal("base64"),
            addresses: z.array(key).max(4),
          })
          .strict()
          .optional(),
      })
      .optional(),
  ]),
  sendTransaction: z.tuple([
    transaction,
    z
      .object({
        encoding: z.literal("base64"),
        skipPreflight: z.literal(false).optional(),
        preflightCommitment: commitment.optional(),
        maxRetries: z.number().int().min(0).max(3).optional(),
        minContextSlot: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  ]),
};
export function rpcRequest(raw: unknown) {
  const body = z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.union([z.string().max(80), z.number().finite()]),
      method: z.string(),
      params: z.array(z.unknown()).max(2).default([]),
    })
    .strict()
    .parse(raw);
  const schema = schemas[body.method];
  if (!schema) throw new Error("Method unavailable.");
  const params = body.params.slice();
  if (["getLatestBlockhash", "getBlockHeight"].includes(body.method) && params.length === 0) params.push({});
  if (["getBalance", "getAccountInfo", "getMultipleAccounts", "getFeeForMessage", "getSignatureStatuses", "simulateTransaction", "sendTransaction"].includes(body.method) && params.length === 1) params.push(undefined);
  schema.parse(params);
  return body;
}
