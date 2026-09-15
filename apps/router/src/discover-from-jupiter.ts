/**
 * Jupiter-informed pool discovery (prebuild, needs RPC + JUPITER_API_KEY).
 *
 * Jupiter's route plan names the exact AMM pools it uses for each stock.
 * Those pools are the liquidity Henar must cover to compete. For every
 * representation that already has a registry pool, this asks Jupiter for a
 * small and a large quote, collects the pools it routed through on venues
 * Henar has an adapter for, reads each pool account from chain (owner must
 * be the venue program; the two mints must be exactly {mint, USDC}), sizes
 * liquidity from the pool's USDC vault, and appends new records to
 * `pools.json` as DISCOVERED (`discoveredFrom: "jupiter-route-plan"`). The
 * on-chain verification pass that follows decides ONCHAIN_VERIFIED.
 *
 * Nothing is trusted from Jupiter except the pool address: program, mints
 * and liquidity all come from the chain.
 */
import { readFile, writeFile } from "node:fs/promises";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { unpackAccount } from "@solana/spl-token";
import { USDC_MINT, fromRaw, type PoolType, type Venue, type VerifiedPool } from "@henar/router-core";
import { routerRepresentation } from "@henar/router-core";
import { quoteJupiter } from "@/lib/execution/adapters/jupiter";
import { decodeLbPair } from "@henar/venue-meteora";
import { decodeDammV2Pool } from "@henar/venue-meteora-damm-v2";

const FILE = "src/data/router/pools.json";
const SIZES_USDC = [100n * 1_000_000n, 5_000n * 1_000_000n];
const PROGRAMS: Record<string, { venue: Venue; poolType: PoolType; program: string }> = {
  raydium: { venue: "raydium", poolType: "clmm", program: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK" },
  dlmm: { venue: "meteora", poolType: "dlmm", program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" },
  damm_v2: { venue: "meteora-damm-v2", poolType: "damm_v2", program: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" },
  whirlpool: { venue: "orca", poolType: "whirlpool", program: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" },
};

/** Map a Jupiter route-plan label to a Henar venue family, or null. Pure. */
export function venueFamilyForLabel(label: string | null | undefined): keyof typeof PROGRAMS | null {
  const l = (label ?? "").toLowerCase();
  if (/raydium\s*clmm|raydium concentrated/.test(l)) return "raydium";
  if (/meteora\s*dlmm/.test(l)) return "dlmm";
  if (/damm\s*v2|meteora\s*dynamic\s*amm\s*v2/.test(l)) return "damm_v2";
  if (/whirlpool|orca/.test(l)) return "whirlpool";
  return null;
}

/** Collect candidate (family, pool) pairs from a route plan. Pure. */
export function candidatesFromRoutePlan(route: { venue: string; pool: string | null; percent: number | null }[]) {
  const out = new Map<string, keyof typeof PROGRAMS>();
  for (const step of route) {
    const family = venueFamilyForLabel(step.venue);
    if (family && step.pool) out.set(step.pool, family);
  }
  return out;
}

type PoolFacts = { mintA: string; mintB: string; vaultA: string; vaultB: string };

function decodeFacts(family: keyof typeof PROGRAMS, data: Buffer): PoolFacts {
  if (family === "raydium") {
    const d = decodeClmmPoolInfoSync(data);
    return { mintA: d.mintA, mintB: d.mintB, vaultA: d.vaultA, vaultB: d.vaultB };
  }
  if (family === "dlmm") {
    const d = decodeLbPair(data) as { tokenXMint: PublicKey; tokenYMint: PublicKey; reserveX: PublicKey; reserveY: PublicKey };
    return { mintA: d.tokenXMint.toBase58(), mintB: d.tokenYMint.toBase58(), vaultA: d.reserveX.toBase58(), vaultB: d.reserveY.toBase58() };
  }
  if (family === "whirlpool") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const orca = require("@orca-so/whirlpools-sdk") as typeof import("@orca-so/whirlpools-sdk");
    const d = orca.ParsableWhirlpool.parse(PublicKey.default, { data, owner: new PublicKey(PROGRAMS.whirlpool.program), executable: false, lamports: 0 });
    if (!d) throw new Error("whirlpool undecodable");
    return { mintA: d.tokenMintA.toBase58(), mintB: d.tokenMintB.toBase58(), vaultA: d.tokenVaultA.toBase58(), vaultB: d.tokenVaultB.toBase58() };
  }
  const d = decodeDammV2Pool(data);
  return { mintA: d.tokenAMint.toBase58(), mintB: d.tokenBMint.toBase58(), vaultA: d.tokenAVault.toBase58(), vaultB: d.tokenBVault.toBase58() };
}

function decodeClmmPoolInfoSync(data: Buffer) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require("@raydium-io/raydium-sdk-v2") as typeof import("@raydium-io/raydium-sdk-v2");
  const d = m.PoolInfoLayout.decode(data);
  return { mintA: d.mintA.toBase58(), mintB: d.mintB.toBase58(), vaultA: d.vaultA.toBase58(), vaultB: d.vaultB.toBase58() };
}

function usdcBalance(account: AccountInfo<Buffer> | null, address: string): bigint | null {
  if (!account) return null;
  try {
    return unpackAccount(new PublicKey(address), account, account.owner).amount;
  } catch {
    return null;
  }
}

export async function discoverFromJupiter(argv = process.argv) {
  const rpc = process.env.SOLANA_RPC_URL;
  const key = process.env.JUPITER_API_KEY;
  if (!rpc || !key) {
    if (argv.includes("--if-configured")) {
      process.stdout.write("discover-from-jupiter: SOLANA_RPC_URL/JUPITER_API_KEY not set; skipped\n");
      return;
    }
    throw new Error("SOLANA_RPC_URL and JUPITER_API_KEY are required.");
  }
  const connection = new Connection(rpc, "confirmed");
  const pools = JSON.parse(await readFile(FILE, "utf8")) as VerifiedPool[];
  const known = new Set(pools.map((p) => p.address));
  const reps = [...new Set(pools.filter((p) => p.enabled || p.eligibility === "ROUTER_ELIGIBLE").map((p) => p.representationId))];
  const candidates = new Map<string, { family: keyof typeof PROGRAMS; representationId: string }>();
  let calls = 0;
  for (const id of reps) {
    const rep = routerRepresentation(id);
    if (!rep) continue;
    for (const size of SIZES_USDC) {
      try {
        const q = await quoteJupiter({ inputMint: USDC_MINT, outputMint: rep.mint, amount: size, slippageBps: 50 }, { allowSlippageAdjustment: true });
        calls += 1;
        for (const [pool, family] of candidatesFromRoutePlan(q.route)) if (!known.has(pool) && !candidates.has(pool)) candidates.set(pool, { family, representationId: id });
      } catch {
        // No route or rate limit: skip this size; the benchmark records the real failure elsewhere.
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  process.stdout.write(`discover-from-jupiter: ${calls} quotes over ${reps.length} representations, ${candidates.size} new candidate pools\n`);
  if (!candidates.size) return;

  const addresses = [...candidates.keys()];
  const infos = await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed");
  const now = new Date().toISOString();
  const added: VerifiedPool[] = [];
  const vaultLookups: { pool: VerifiedPool; vault: string }[] = [];
  for (let i = 0; i < addresses.length; i += 1) {
    const address = addresses[i];
    const { family, representationId } = candidates.get(address)!;
    const rep = routerRepresentation(representationId)!;
    const info = infos[i];
    const spec = PROGRAMS[family];
    if (!info || info.owner.toBase58() !== spec.program) continue;
    let facts: PoolFacts;
    try {
      facts = decodeFacts(family, info.data);
    } catch {
      continue;
    }
    const pair = new Set([facts.mintA, facts.mintB]);
    if (!(pair.has(rep.mint) && pair.has(USDC_MINT) && pair.size === 2)) continue;
    const pool: VerifiedPool = {
      id: `${spec.venue}:${address}`,
      representationId,
      mint: rep.mint,
      provider: rep.provider,
      tokenSymbol: rep.tokenSymbol,
      venue: spec.venue,
      address,
      programId: spec.program,
      poolType: spec.poolType,
      baseMint: facts.mintA,
      quoteMint: facts.mintB,
      feeBps: null,
      feeConfig: null,
      observedTokenPrograms: null,
      tvlUsd: null,
      discoveredFrom: "jupiter-route-plan",
      discoveredAt: now,
      verifiedAt: now,
      verification: "DISCOVERED",
      onchainVerifiedAt: null,
      verificationDetail: null,
      eligibility: "ROUTER_ELIGIBLE",
      dbc: null,
      enabled: false,
      disabledReason: "liquidity not yet sized",
    };
    added.push(pool);
    vaultLookups.push({ pool, vault: facts.mintA === USDC_MINT ? facts.vaultA : facts.vaultB });
  }
  // Liquidity: twice the USDC-side vault balance (a two-sided pool's USDC leg
  // is half of its value at the current price). Chain data, labelled as such.
  const vaults = await connection.getMultipleAccountsInfo(vaultLookups.map((v) => new PublicKey(v.vault)), "confirmed");
  vaultLookups.forEach(({ pool }, i) => {
    const bal = usdcBalance(vaults[i] ?? null, vaultLookups[i].vault);
    if (bal === null) return;
    const usd = Number(fromRaw(bal.toString())) / 1_000_000;
    pool.tvlUsd = usd * 2;
    pool.discoveredFrom = "jupiter-route-plan (tvl = 2 × USDC vault)";
    const ok = pool.tvlUsd >= 1_000;
    pool.enabled = ok;
    pool.disabledReason = ok ? null : `TVL $${Math.round(pool.tvlUsd)} below $1000 floor`;
  });
  const merged = [...pools, ...added];
  await writeFile(FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  process.stdout.write(`discover-from-jupiter: added ${added.length} pools (${added.filter((p) => p.enabled).length} enabled): ${added.map((p) => `${p.venue}:${p.tokenSymbol}:${p.address.slice(0, 6)}`).join(", ")}\n`);
}

if (process.argv[1]?.endsWith("discover-from-jupiter.ts")) {
  discoverFromJupiter().catch((e) => {
    process.stderr.write(`${e}\n`);
    process.exitCode = process.argv.includes("--if-configured") ? 0 : 1;
  });
}
