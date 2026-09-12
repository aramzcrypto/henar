import { safeError } from "../../src/lib/protocol/errors";
import {
  readFile,
  writeFile,
  mkdir,
  open,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { protocolContext } from "../../src/lib/protocol/context";
import { jobs, executeJob } from "./engine";
import { Dispatcher } from "./transactions";
type Pending = { signature: string; blockhash: string };
type JobState = {
  attempts: number;
  nextAttempt: number;
  pending: Pending[];
  error?: string;
  updatedAt: string;
};
type State = Record<string, JobState>;
const directory = resolve(process.env.SOLVER_STATE_DIR ?? "solver-state"),
  execute = process.argv.includes("--execute"),
  once = process.argv.includes("--once") || !execute;
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
async function blockhashValid(blockhash: string) {
  const response = await fetch(process.env.SOLANA_RPC_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "isBlockhashValid",
      params: [blockhash, { commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || typeof data.result?.value !== "boolean")
    throw new Error("Unable to reconcile submitted transaction.");
  return data.result.value as boolean;
}
async function main() {
  const ctx = await protocolContext();
  if (!execute) {
    console.log(
      JSON.stringify({
        mode: "read-only",
        program: ctx.programId.toBase58(),
        jobs: (await jobs()).map((j) => ({ key: j.key, kind: j.kind })),
      }),
    );
    return;
  }
  const signerPath = process.env.SOLVER_KEYPAIR_PATH;
  if (!signerPath)
    throw new Error("Set SOLVER_KEYPAIR_PATH on the worker, never in Vercel.");
  const mode = (await stat(signerPath)).mode;
  if (mode & 0o077)
    throw new Error("Solver key file must have permissions 0600.");
  const bytes = JSON.parse(await readFile(signerPath, "utf8"));
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    bytes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw new Error("Invalid solver key file.");
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  const limit = process.env.SOLVER_MAX_SETTLEMENT_USDC_BASE_UNITS;
  if (!limit || !/^\d+$/.test(limit) || BigInt(limit) <= 0n)
    throw new Error("Set an explicit positive per-settlement USDC budget.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await open(resolve(directory, "worker.lock"), "wx", 0o600).catch(
    () => {
      throw new Error(
        "Another worker holds this state directory. Reconcile pending signatures before clearing a stale lock.",
      );
    },
  );
  await lock.writeFile(String(process.pid));
  let state: State = {};
  try {
    try {
      state = JSON.parse(
        await readFile(resolve(directory, "journal.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    async function persist() {
      const temp = resolve(directory, "journal.tmp");
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, resolve(directory, "journal.json"));
    }
    do {
      for (const job of await jobs()) {
        if (stopped) break;
        const record = state[job.key] ?? {
          attempts: 0,
          nextAttempt: 0,
          pending: [],
          updatedAt: new Date().toISOString(),
        };
        state[job.key] = record;
        if (record.nextAttempt > Date.now()) continue;
        try {
          let unresolved = false;
          for (const pending of record.pending) {
            const result = (
              await ctx.c.getSignatureStatuses([pending.signature], {
                searchTransactionHistory: true,
              })
            ).value[0];
            if (!result) {
              if (await blockhashValid(pending.blockhash)) unresolved = true;
            } else if (
              !["confirmed", "finalized"].includes(
                result.confirmationStatus ?? "",
              )
            )
              unresolved = true;
          }
          if (unresolved) {
            record.nextAttempt = Date.now() + 20000;
            await persist();
            continue;
          }
          record.pending = [];
          const dispatcher = new Dispatcher(
            ctx.c,
            signer,
            async (signature, blockhash) => {
              record.pending.push({ signature, blockhash });
              await persist();
            },
          );
          await executeJob(job, dispatcher, BigInt(limit));
          record.attempts = 0;
          record.error = undefined;
          record.nextAttempt = Date.now() + 20000;
        } catch (error) {
          record.attempts++;
          record.error = safeError(error, "Execution failed");
          record.nextAttempt =
            Date.now() +
            Math.min(300000, 5000 * 2 ** Math.min(record.attempts, 6));
          console.error(
            JSON.stringify({
              job: job.key,
              error: record.error,
              attempts: record.attempts,
            }),
          );
        }
        record.updatedAt = new Date().toISOString();
        await persist();
      }
      await writeFile(
        resolve(directory, "health.json"),
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          jobs: Object.keys(state).length,
          errors: Object.values(state).filter((s) => s.error).length,
        }),
        { mode: 0o600 },
      );
      if (!once && !stopped) await new Promise((r) => setTimeout(r, 10000));
    } while (!once && !stopped);
  } finally {
    await lock.close();
    await unlink(resolve(directory, "worker.lock"));
  }
}
main().catch((error) => {
  console.error(safeError(error, "Worker failed"));
  process.exitCode = 1;
});
