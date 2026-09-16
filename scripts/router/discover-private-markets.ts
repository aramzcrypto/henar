/**
 * Private-market discovery: PreStocks and Tessera products → router artifacts.
 *
 *   npm run router:discover:private
 *
 * Reads both provider catalogs live, keeps only rows with a valid Solana
 * mint, reads every mint account through RPC (decimals, token program,
 * extensions — the same inspection the router uses), finds each product's
 * Meteora DLMM pools by scanning the DLMM program for pairs whose tokenX or
 * tokenY is the product mint (memcmp at the LbPair layout offsets), and
 * confirms each pool and its TVL through Meteora's own DLMM data API.
 *
 * Writes:
 *   src/data/router/private-markets.json   the products the router may know
 *   src/data/router/mints.json             adds/replaces the product mint rows
 *   src/data/router/pools.json             adds/replaces the product pool rows
 *   src/data/router/non-routable-pairs.json  pairs Henar indexes but never routes
 *
 * The registry holds only USDC routes, routing legs through a qualified
 * intermediate, and the intermediates' own USDC pools. A pool pairing a
 * product with an arbitrary token (one private product against another, or
 * against an unqualified asset) is intelligence, not a route: it goes to the
 * non-routable artifact, exactly as the equity discovery passes do.
 *
 * Pools are written DISCOVERED; `router:verify:pools` (also the Vercel
 * prebuild) is the only writer of ONCHAIN_VERIFIED. A pair with TVL at or
 * above MIN_TVL_USD is enabled; anything else is recorded disabled with its
 * reason. Requires SOLANA_RPC_URL.
 */
import { readFile, writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { USDC_MINT, inspectionFromAccount, isQualifiedIntermediate, verifiedMintFromInspection, type VerifiedMint, type VerifiedPool } from "@henar/router-core";
import { privateMarketCatalog } from "../../src/lib/private-markets/registry";
import type { PrivateMarketsArtifact, RouterPrivateProduct } from "../../src/lib/private-markets/router-artifact";

const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const DATAPI = "https://dlmm.datapi.meteora.ag/pools";
const MIN_TVL_USD = 1_000;
const ARTIFACT = "src/data/router/private-markets.json";
const MINTS = "src/data/router/mints.json";
const POOLS = "src/data/router/pools.json";
const NON_ROUTABLE = "src/data/router/non-routable-pairs.json";
const LBPAIR_TOKEN_X_OFFSET = 88;
const LBPAIR_TOKEN_Y_OFFSET = 120;

const datapiSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  token_x: z.object({ address: z.string() }),
  token_y: z.object({ address: z.string() }),
  tvl: z.number().nullish(),
  pool_config: z.object({ bin_step: z.number().nullish(), base_fee_pct: z.number().nullish() }).nullish(),
  is_blacklisted: z.boolean().nullish(),
});

async function dlmmPoolsForMint(connection: Connection, mint: string) {
  const found = new Set<string>();
  for (const offset of [LBPAIR_TOKEN_X_OFFSET, LBPAIR_TOKEN_Y_OFFSET]) {
    const accounts = await connection.getProgramAccounts(new PublicKey(METEORA_DLMM_PROGRAM), {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset, bytes: mint } }],
    });
    for (const a of accounts) found.add(a.pubkey.toBase58());
  }
  return [...found];
}

async function datapiPool(address: string) {
  const response = await fetch(`${DATAPI}/${address}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const parsed = datapiSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  if (!rpc) throw new Error("SOLANA_RPC_URL is required for private-market discovery.");
  const connection = new Connection(rpc, "confirmed");
  const discoveredAt = new Date().toISOString();

  const catalog = await privateMarketCatalog();
  for (const s of catalog.sources) process.stdout.write(`${s.provider}: ${s.status} (${s.products} products)${s.error ? ` — ${s.error}` : ""}\n`);
  if (catalog.sources.every((s) => s.status === "unavailable")) throw new Error("No provider catalog could be read; nothing written.");

  const products: RouterPrivateProduct[] = catalog.products.map((p) => {
    const company = catalog.companies.find((c) => c.id === p.companyId)!;
    return { provider: p.provider, providerProductId: p.providerProductId, symbol: p.symbol, name: p.name, mint: p.mint, companySlug: company.slug, companyName: company.name, sourceUrl: p.provenance.url ?? "", discoveredAt };
  });

  // Mint facts, one RPC read per mint, through the router's own inspection.
  const mints = products.map((p) => p.mint);
  const [slot, infos] = await Promise.all([connection.getSlot("confirmed"), connection.getMultipleAccountsInfo(mints.map((m) => new PublicKey(m)), "confirmed")]);
  const rows: VerifiedMint[] = [];
  mints.forEach((mint, i) => {
    const account = infos[i];
    if (!account) {
      process.stdout.write(`  ${mint}: no account; product left unverified\n`);
      return;
    }
    const row = verifiedMintFromInspection(inspectionFromAccount(mint, account, discoveredAt), slot, discoveredAt);
    rows.push(row);
    process.stdout.write(`  ${products[i].provider}:${products[i].symbol} ${row.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ? "Token-2022" : "Token"} dec=${row.decimals} fee=${row.transferFeeBps ?? 0}bps ${row.supported ? "supported" : `UNSUPPORTED: ${row.unsupportedReason}`}\n`);
  });
  const existingMints = JSON.parse(await readFile(MINTS, "utf8")) as VerifiedMint[];
  const merged = new Map(existingMints.map((m) => [m.mint, m]));
  for (const row of rows) merged.set(row.mint, row);
  const mintRows = [...merged.values()].sort((a, b) => (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0));
  await writeFile(MINTS, `${JSON.stringify(mintRows, null, 2)}\n`, "utf8");

  // Pools: DLMM program scan by mint, confirmed and valued through Meteora's data API.
  const existingPools = JSON.parse(await readFile(POOLS, "utf8")) as VerifiedPool[];
  const poolMap = new Map(existingPools.map((p) => [p.address, p]));
  const nonRoutableFile = JSON.parse(await readFile(NON_ROUTABLE, "utf8")) as { generatedAt: string; pools: Record<string, unknown>[] };
  const nonRoutable = new Map(nonRoutableFile.pools.map((p) => [String(p.address), p]));
  let added = 0;
  let indexed = 0;
  for (const product of products) {
    let addresses: string[] = [];
    try {
      addresses = await dlmmPoolsForMint(connection, product.mint);
    } catch (error) {
      process.stdout.write(`  ${product.symbol}: DLMM scan failed (${(error as Error).message}); no pools recorded\n`);
      continue;
    }
    for (const address of addresses) {
      const meta = await datapiPool(address);
      if (!meta) {
        process.stdout.write(`  ${product.symbol}: pool ${address} not in Meteora data API; skipped\n`);
        continue;
      }
      if (meta.is_blacklisted) continue;
      const pair = [meta.token_x.address, meta.token_y.address];
      if (!pair.includes(product.mint)) continue;
      const other = pair.find((m) => m !== product.mint)!;
      const usdcPair = other === USDC_MINT;
      const tvl = typeof meta.tvl === "number" && Number.isFinite(meta.tvl) ? meta.tvl : null;
      /* Anything that is neither a USDC route nor a leg through a qualified
         intermediate stays out of the registry: it is recorded as
         intelligence so the market is visible without an automatic route
         ever passing through an unapproved asset. */
      if (!usdcPair && !isQualifiedIntermediate(other)) {
        nonRoutable.set(address, {
          address,
          venue: "meteora",
          programId: METEORA_DLMM_PROGRAM,
          stockMint: product.mint,
          counterMint: other,
          representationId: `${product.provider}:${product.mint}`,
          provider: product.provider,
          tokenSymbol: product.symbol,
          tvlUsd: tvl,
          status: "DISCOVERED_NON_ROUTABLE_PAIR",
          discoverySources: ["METEORA_ONCHAIN", "METEORA_DATAPI"],
          discoveredAt: discoveredAt,
        });
        indexed++;
        continue;
      }
      const eligibility: VerifiedPool["eligibility"] = usdcPair ? "ROUTER_ELIGIBLE" : "ROUTING_LEG";
      let disabledReason: string | null = null;
      if (tvl === null || tvl < MIN_TVL_USD) disabledReason = `TVL ${tvl === null ? "unknown" : `$${Math.round(tvl)}`} below $${MIN_TVL_USD} floor`;
      const previous = poolMap.get(address);
      const pool: VerifiedPool = {
        id: `meteora:${address}`,
        representationId: `${product.provider}:${product.mint}`,
        mint: product.mint,
        provider: product.provider,
        tokenSymbol: product.symbol,
        venue: "meteora",
        address,
        programId: METEORA_DLMM_PROGRAM,
        poolType: "dlmm",
        baseMint: meta.token_x.address,
        quoteMint: meta.token_y.address,
        feeBps: typeof meta.pool_config?.base_fee_pct === "number" ? Math.round(meta.pool_config.base_fee_pct * 100) : null,
        feeConfig: typeof meta.pool_config?.bin_step === "number" ? { binStep: meta.pool_config.bin_step } : null,
        observedTokenPrograms: null,
        tvlUsd: tvl,
        discoveredFrom: "meteora-dlmm-program-scan + dlmm.datapi.meteora.ag",
        discoverySources: ["METEORA_ONCHAIN", "METEORA_DATAPI"],
        discoveredAt: previous?.discoveredAt ?? discoveredAt,
        verifiedAt: discoveredAt,
        verification: "DISCOVERED",
        onchainVerifiedAt: null,
        verificationDetail: null,
        eligibility,
        dbc: null,
        enabled: disabledReason === null,
        disabledReason,
      };
      poolMap.set(address, pool);
      added++;
      process.stdout.write(`  ${product.symbol}: ${meta.name ?? address} ${eligibility} tvl=$${tvl === null ? "?" : Math.round(tvl)} ${pool.enabled ? "enabled" : `disabled (${disabledReason})`}\n`);
    }
  }
  /* The file's order is part of its contract: representation, then depth.
     Two runs that find the same pools must produce the same bytes. */
  const sorted = [...poolMap.values()].sort((a, b) =>
    a.representationId === b.representationId ? (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) : a.representationId.localeCompare(b.representationId),
  );
  await writeFile(POOLS, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  await writeFile(
    NON_ROUTABLE,
    `${JSON.stringify({ generatedAt: discoveredAt, pools: [...nonRoutable.values()].sort((a, b) => String(a.address).localeCompare(String(b.address))) }, null, 2)}\n`,
    "utf8",
  );

  const artifact: PrivateMarketsArtifact = {
    generatedAt: discoveredAt,
    sources: Object.fromEntries(catalog.sources.map((s) => [s.provider, `${s.url} (${s.status})`])),
    products: products.sort((a, b) => a.provider.localeCompare(b.provider) || a.symbol.localeCompare(b.symbol)),
  };
  await writeFile(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${ARTIFACT}: ${products.length} products; ${rows.length} mint rows; ${added} DLMM pool rows; ${indexed} non-routable pairs indexed.\n`);
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
